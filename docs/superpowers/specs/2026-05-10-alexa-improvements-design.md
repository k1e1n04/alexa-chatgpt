# Alexa ChatGPT スキル改善設計書

## 概要

既存の会話・Web検索・ショッピングリスト・Googleカレンダー機能に加え、以下2つの機能を追加する。

1. **朝のブリーフィング** — 「おはよう」等の挨拶フレーズで天気 + カレンダーを自動読み上げ
2. **長期記憶** — DynamoDB にセッション間の会話サマリーを永続化し、次回セッションで文脈を継続

---

## 機能1: 朝のブリーフィング

### ユーザー体験

「アレクサ、チャットを開いて。おはよう」と言うと、AIが以下をまとめて読み上げる:
- 今日の天気予報（晴れ/曇り/雨、最高・最低気温）
- Googleカレンダーの今日の予定一覧

### トリガー判定

`routingDecider.ts` にブリーフィングモード判定を追加する。  
トリガーフレーズ例: 「おはよう」「今日の予定は」「今日どう」「今日の天気」

### 天気API

[Open Meteo API](https://open-meteo.com/) を使用する。

- 無料・APIキー不要
- エンドポイント: `https://api.open-meteo.com/v1/forecast`
- パラメータ: `latitude`, `longitude`, `daily=weathercode,temperature_2m_max,temperature_2m_min`, `timezone=Asia/Tokyo`
- 緯度経度は Lambda 環境変数 `WEATHER_LAT`, `WEATHER_LON` で設定

### 実装コンポーネント

| ファイル | 変更内容 |
|---|---|
| `lambda/src/services/weather.ts` | 新規作成。Open Meteo API呼び出し、天気コードを日本語に変換して返す |
| `lambda/src/chat/routingDecider.ts` | `isBriefingQuery()` 関数を追加 |
| `lambda/src/services/briefing.ts` | 新規作成。weather.ts と googleCalendar.ts を Promise.all で並行呼び出しして結果を返すヘルパー |
| `lambda/src/handlers/ChatIntentHandler.ts` | ブリーフィングモードのルーティングを追加 |

### データフロー

```
ユーザー「おはよう」
→ routingDecider: isBriefingQuery() = true
→ weather.ts と googleCalendar.ts を Promise.all で並行実行
→ 天気データ + 予定一覧をシステムプロンプトに含めてOpenAIへ
→ AIが自然な日本語にまとめて読み上げ
```

### エラーハンドリング

- 天気API失敗時: 天気情報なしでカレンダーのみ読み上げ
- カレンダーAPI失敗時: 天気のみ読み上げ
- 両方失敗時: 通常の会話モードにフォールバック

---

## 機能2: 長期記憶

### ユーザー体験

前回のセッションで話した内容をAlexaが覚えており、「先日言ってたあれ」が通じるようになる。

### データ設計

**DynamoDB テーブル**: `alexa-chatgpt-memory`

| フィールド | 型 | 内容 |
|---|---|---|
| `userId` (PK) | String | Alexa の `context.System.user.userId` |
| `summary` | String | 直近会話のAI生成サマリー（最大500文字） |
| `updatedAt` | String | ISO 8601 形式のタイムスタンプ |

記憶は「最新サマリー1件」のみ保持し、セッション終了ごとに上書きする。履歴管理はしない。

### 実装コンポーネント

| ファイル | 変更内容 |
|---|---|
| `lambda/src/services/memory.ts` | 新規作成。DynamoDB get/put ラッパー |
| `lambda/src/handlers/LaunchRequestHandler.ts` | 起動時に memory.ts で記憶を取得し、セッション属性に格納 |
| `lambda/src/handlers/ChatIntentHandler.ts` | セッション属性から記憶を読み取り、OpenAIのシステムプロンプトに注入 |
| `lambda/src/handlers/CancelAndStopHandler.ts` | セッション終了時に会話ログをOpenAIで要約してmemory.tsに保存 |

### データフロー

```
【起動時】
LaunchRequestHandler
→ memory.get(userId) でサマリー取得
→ セッション属性 "memoryContext" に格納

【会話中】
ChatIntentHandler
→ セッション属性から "memoryContext" を読み取り
→ OpenAI のシステムプロンプトに「前回の会話コンテキスト: {summary}」として注入

【会話ターンごと】
ChatIntentHandler
→ ユーザーの query と AI の返答を `conversationLog` としてセッション属性に配列で追記

【終了時】
CancelAndStopHandler
→ セッション属性の `conversationLog` を OpenAI に渡して日本語サマリーを生成（最大500文字）
→ memory.put(userId, summary) で DynamoDB に保存
→ conversationLog が空（会話なしで終了）の場合はスキップ
```

### AWS 設定

- DynamoDB テーブルをap-northeast-1に作成（Lambdaと同リージョン）
- Lambda の IAM ロールに `dynamodb:GetItem`, `dynamodb:PutItem` を追加
- 環境変数 `MEMORY_TABLE_NAME=alexa-chatgpt-memory` を追加

### エラーハンドリング

- DynamoDB 読み取り失敗時: 記憶なしで通常起動（スキル動作は継続）
- DynamoDB 書き込み失敗時: ログ出力のみ、ユーザーへのエラー通知なし
- 記憶が空の場合: システムプロンプトへの注入をスキップ

---

## 実装順序

1. **機能1（朝のブリーフィング）** を先に実装する
   - 外部依存（DynamoDB設定）なし、既存カレンダー連携を再利用できる
2. **機能2（長期記憶）** を次に実装する
   - DynamoDBテーブル作成とIAM設定が必要

---

## スコープ外

- ニュース読み上げ（情報ソース選定が別途必要）
- 音声メモ機能（優先度低）
- 記憶の削除コマンド（「記憶を消して」等）
