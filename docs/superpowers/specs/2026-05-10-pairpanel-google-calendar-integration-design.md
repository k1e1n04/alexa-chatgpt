# Design: pairpanel お買い物リスト & Google Calendar 連携

**Date:** 2026-05-10  
**Status:** Approved

---

## 概要

Alexa スキル「チャッピー」に pairpanel のお買い物リストと Google Calendar を連携させる。OpenAI Responses API の Function Calling（ツール呼び出し）を使い、既存の `ChatIntent` と自然な会話フローを維持したまま外部 API を操作できるようにする。

---

## アーキテクチャ

### 現在

```
Alexa → Lambda → OpenAI Responses API (web_search)
```

### 変更後

```
Alexa → Lambda → OpenAI Responses API
                    │ (GPT が関数呼び出しを決定)
                    ├→ pairpanel API (お買い物)
                    └→ Google Calendar API (予定)
                    │ (結果を GPT にフィードバック)
                    └→ 最終的な音声テキスト
```

GPT が `tools` 配列の中から適切な関数を自律選択し、Lambda 内で実行する。関数呼び出しが発生した場合のみ OpenAI に2回リクエストする（1回目: 関数特定、2回目: 結果を音声テキストに整形）。

**タイムアウト制約:** Alexa は8秒以内に応答が必要。各 OpenAI 呼び出しのタイムアウトを 3500ms に設定し、外部 API 呼び出しは 1000ms 以内に収める。

---

## 登録するカスタム関数（Tools）

### pairpanel お買い物リスト

| 関数名 | 説明 | エンドポイント |
|--------|------|--------------|
| `add_shopping_item(name: string)` | 商品をリストに追加 | `POST /api/v1/shopping/register` |
| `get_shopping_list()` | リスト一覧を取得 | `GET /api/v1/shopping` |
| `complete_all_shopping(ids: string[])` | 指定アイテムを完了 | `POST /api/v1/shopping/complete-all` |

- `add_shopping_item` は `name` と `isShared: false` のみ送信（必須フィールド）
- 「牛乳と卵を追加して」のような複数アイテムは GPT が `add_shopping_item` を複数回呼ぶ
- 完了操作では GPT がリスト取得 → 対象アイテムの ID を特定 → `complete_all_shopping` を呼ぶ

### Google Calendar

| 関数名 | 説明 |
|--------|------|
| `get_today_events()` | 今日の予定一覧を取得 |
| `add_calendar_event(title: string, start_time: string, end_time: string)` | 予定を追加（ISO 8601 形式、JST） |

---

## 認証

| サービス | 方式 | Lambda 環境変数 |
|---------|------|----------------|
| pairpanel | Alexa スキル専用 API キー（pairpanel 側で新規実装） | `PAIRPANEL_API_KEY`, `PAIRPANEL_API_URL` |
| Google Calendar | OAuth2 リフレッシュトークン | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN` |

**前提:** pairpanel バックエンドに `X-Api-Key` ヘッダーを用いたスキル専用 API キー認証を追加する（本スコープ外・別タスク）。

---

## コード変更

### 修正: `lambda/src/services/openai.ts`

- `tools` 配列にカスタム関数定義を追加（`web_search` と並列）
- tool call ループを追加:
  1. `response.output` に `function_call` が含まれていれば `toolExecutor` に渡して実行
  2. 結果を `function_call_output` として再送信
  3. GPT の最終テキストを返す
- 1回あたりの OpenAI タイムアウト: 7000ms → 3500ms

### 新規: `lambda/src/services/pairpanel.ts`

- `addShoppingItem(name: string): Promise<{ id: string; name: string }>`
- `getShoppingList(): Promise<{ id: string; name: string }[]>`
- `completeAllShopping(ids: string[]): Promise<void>`
- `fetch` で実装（追加パッケージなし）、`PAIRPANEL_API_KEY` / `PAIRPANEL_API_URL` を使用

### 新規: `lambda/src/services/googleCalendar.ts`

- `getTodayEvents(): Promise<{ title: string; start: string; end: string }[]>`
- `addCalendarEvent(title: string, startTime: string, endTime: string): Promise<void>`
- `googleapis` パッケージを追加し、リフレッシュトークンで自動的にアクセストークンを取得
- タイムゾーン: `Asia/Tokyo`

### 新規: `lambda/src/services/toolExecutor.ts`

- `executeTool(name: string, args: Record<string, unknown>): Promise<string>`
- `switch` 文で関数名から `pairpanel.ts` / `googleCalendar.ts` にルーティング
- 結果を JSON 文字列で返す

### 変更なし

- `ChatIntentHandler.ts`
- `LaunchRequestHandler.ts`
- その他ハンドラー類

---

## エラーハンドリング

- pairpanel / Google Calendar API がエラーを返した場合 → エラーメッセージを JSON 文字列で GPT にフィードバック → GPT が「登録できませんでした」などと音声で伝える
- 全体が 8 秒を超過した場合 → 既存のタイムアウトエラーメッセージ（「少し時間がかかっています…」）で対応

---

## 依存パッケージ

```
googleapis  (Google Calendar API クライアント)
```

---

## スコープ外（別タスク）

- pairpanel バックエンドへの API キー認証追加
- Google Calendar OAuth2 リフレッシュトークンの初期取得手順
- YouTube Music 連携（将来）
- やりたいことリスト連携（将来）
