# スーパーエージェント化 Phase 1 — 能動エージェント基盤の構築

**日付**: 2026-05-11
**ステータス**: 設計レビュー待ち
**前提**: [方向性マップ](./2026-05-11-super-agent-directions-map.md)
**カバー範囲**: C-10 プロアクティブ通知 + C-11 エージェントワークフロー（Hybrid 構成）

---

## 1. 目的（Why）

現状の Alexa スキル「チャッピー」は受動型（聞かれたら答える）。これを能動型エージェント（自分でプランを立て・複雑な依頼をこなし・聞かれる前に伝える）へ進化させる。

### 達成基準

- 「来週の連休に旅行候補出して」のようなマルチステップ依頼が成立する
- 朝のブリーフィングが自動配信される（こちらから「おはよう」と言わなくても届く）
- 雨予報など条件成立時に能動的に通知が来る
- 重い依頼は時間切れせず、結果が完成したら通知で届く
- 破壊的な操作には適切な確認が入る

### 非目標（Phase 1 では扱わない）

- 声紋による健 / 奈緒の識別（Phase 2）
- ベクトル記憶 / RAG（Phase 3）
- ブラウザ自動化（Phase 3）
- Echo Show APL（Phase 3）
- 購買・送信系の自動実行（高リスクのため Phase 2 で pairpanel 承認 UI 導入後）

---

## 2. 現状サマリ

- **頭脳**: OpenAI Responses API (`gpt-4.1-mini`) + Gemini（`research_web` ツール）
- **既存ツール**: Google Calendar / SwitchBot / Slack 送信 / 買い物リスト（pairpanel API 経由）/ Web 調査
- **メモリ**: DynamoDB に 1000 文字以内の要約（単一ユーザー単位）
- **デプロイ**: AWS Lambda（`ap-northeast-1`、30 秒タイムアウト）
- **既存 pairpanel 連携**: 買い物リスト API を Alexa スキルから呼び出している（`X-Api-Key / X-User-Id / X-Pair-Id` ヘッダー認証）

---

## 3. アーキテクチャ（Option B: ハイブリッド）

### 構成図

```
┌─────────────────┐  voice   ┌──────────────────────────┐
│ Alexa Device    │ ───────▶ │ Lambda (ChatIntent)      │
│ (Echo)          │          │  ┌────────────────────┐  │
└─────────────────┘          │  │ Agent Loop         │  │
        ▲                    │  │ (ReAct + Plan)     │  │
        │ Reminders / LED    │  └────────────────────┘  │
        │                    │           │              │
┌─────────────────┐          │           ▼              │
│ pairpanel       │ ◀── HTTP │  ┌────────────────────┐  │
│ Web Dashboard   │          │  │ Tools (existing+   │  │
└─────────────────┘          │  │  make_plan,        │  │
        ▲                    │  │  defer_to_async,   │  │
        │ POST notif         │  │  request_approval) │  │
        │                    │  └────────────────────┘  │
        │                    └──────────────────────────┘
        │                            │ start
        │                            ▼
        │ POST notif       ┌──────────────────────┐
        ├─────────────────│ Step Functions       │
        │                  │ (async agent loop)   │
        │ Reminders API    │                      │
        │ Lambda 呼び出し  │  + DynamoDB          │
        │                  │    agent-tasks       │
        │                  └──────────────────────┘
        │                            ▲
        │                            │ trigger
┌──────────────────┐                 │
│ EventBridge cron │ ────────────────┘
└──────────────────┘
```

### 主要な責務分担

| コンポーネント | 責務 |
|---|---|
| **Lambda ChatIntent** | 同期会話、Plan-Execute 同期実行、軽い依頼の応答 |
| **Step Functions (async-agent)** | 重い依頼の非同期実行、cron 駆動の定期タスク |
| **DynamoDB agent-tasks** | 非同期タスクの状態（plan / status / result） |
| **DynamoDB memory** | 既存の会話要約（変更なし） |
| **EventBridge** | cron スケジュール、条件トリガー |
| **pairpanel API（拡張）** | 通知エンドポイント、承認カード、結果表示 |
| **Notification Dispatcher** | pairpanel + Alexa Reminders への配信 |

---

## 4. エージェント思考ループ

### 4.1 既存（参考）

`lambda/src/services/openai.ts` の `chat()` 関数：

- `MAX_TOOL_ROUNDS = 3`
- ReAct 風ループ：tool 呼び出し → 結果 → 次の判断
- `previous_response_id` で会話コンテキスト維持

### 4.2 変更後

**「自己プランニング機能付き ReAct」**

```
[ユーザー発話]
      │
      ▼
[初回 LLM 呼び出し]
      │
      ├─ Tool が無い → そのまま応答（既存と同じ）
      ├─ Tool 呼び出し（軽） → 実行 → 次のラウンド（既存）
      ├─ make_plan ツール呼び出し → プラン JSON 取得 → 計画モードへ
      └─ defer_to_async ツール呼び出し → Step Functions に投げる
      │
      ▼
[計画モード（make_plan 使用後）]
   - MAX_TOOL_ROUNDS = 8
   - プランの各ステップを順次実行
   - 25 秒経過 OR ラウンド 5 超で defer_to_async に切り替え
```

### 4.3 新ツール

#### `make_plan`

```typescript
{
  name: "make_plan",
  description:
    "ユーザーの依頼が複数ステップ必要だと判断した時に呼び出して、" +
    "実行プランを宣言する。プランを宣言した後は、ステップを順次実行する。",
  parameters: {
    goal: string,         // 最終ゴール（人間に説明できる形）
    steps: string[],      // 実行ステップの自然文リスト（3〜8 個）
    estimated_seconds: number,  // 想定所要時間
  }
}
```

レスポンス: `{ acknowledged: true, planId: "..." }`

#### `defer_to_async`

```typescript
{
  name: "defer_to_async",
  description:
    "30 秒以内に完了しない見込みのタスクを非同期に切り替える。" +
    "重い Web 調査・複数ツール連携・長文生成などで使う。" +
    "呼び出し後はユーザーに「結果出たら通知します」と返す。",
  parameters: {
    goal: string,
    plan: string[],
    delivery: "pairpanel" | "alexa-reminder" | "both",
  }
}
```

レスポンス: `{ taskId: "abc123", estimatedAt: "ISO8601" }`

#### `request_approval`

```typescript
{
  name: "request_approval",
  description:
    "High リスクの操作（外部送信・購買・複数日の予定変更など）の" +
    "実行前に pairpanel 経由で承認を求める。",
  parameters: {
    action: string,       // 何をするのか
    details: object,      // 実行詳細（引数）
    timeoutMin: number,   // 承認待ちタイムアウト（分）
  }
}
```

レスポンス: `{ approved: boolean, approverUserId?: string }`（Phase 2 で実装、Phase 1 では未使用）

### 4.4 モデル選定

- 既定: 既存の `gpt-4.1-mini`（変更なし）
- 計画モード時のみ `OPENAI_MODEL_PLANNING` env で `gpt-5-mini` 等の上位モデルへ切替可能に
- コスト管理: per-request 上限金額をログに記録（後の Phase 3 用）

---

## 5. 非同期エスカレーション

### 5.1 エスカレーション基準（OR）

1. LLM が `defer_to_async` を呼んだ
2. Lambda 実行時間が 25 秒を超え、かつまだ `function_call` が残っている
3. プランのステップが 6 個以上ある（推定 30 秒以上）

### 5.2 ユーザー体験

```
ユーザー: 「来週の連休に旅行候補出して」

(同期 Lambda 内で LLM が make_plan → defer_to_async)

チャッピー: 「了解。健と奈緒のカレンダー見て、天気と予算込みで
            候補を出します。10 分くらいで結果を pairpanel に出します」
       ↓
   (Step Functions が動く 1〜30 分)
       ↓
完了通知:
  - pairpanel ダッシュボードに結果カード出現
  - Alexa LED が黄色く点滅（Reminders API で「旅行候補が出来ました」）

(後で)
ユーザー: 「アレクサ、チャッピーで旅行候補見せて」
チャッピー: 「3 つあります。1 つ目は…」（DynamoDB から結果を読み上げ）
```

### 5.3 DynamoDB `agent-tasks` テーブル

| 属性 | 型 | 説明 |
|---|---|---|
| `taskId` (PK) | string | UUID |
| `userId` | string | Alexa userId |
| `status` | string | `pending` / `running` / `completed` / `failed` |
| `goal` | string | ユーザー依頼の要旨 |
| `plan` | list<string> | プランステップ |
| `result` | string | 結果サマリ（Alexa で読み上げ可能な形式） |
| `resultDetails` | map | 構造化結果（pairpanel 表示用） |
| `createdAt` | string | ISO8601 |
| `completedAt` | string | ISO8601 |
| `error` | string | エラー時のメッセージ |
| `stepExecutionArn` | string | Step Functions execution ARN |

TTL: 30 日（古いタスクは自動削除）

### 5.4 Step Functions ステートマシン

```
[Start]
   │
   ▼
[Init Task]  ← agent-tasks に PUT (status=running)
   │
   ▼
[Agent Loop] ← Lambda 呼び出し（同期 chat と同じロジック、ただし時間制約緩い）
   │   - 1 ループ最大 60 秒
   │   - 最大 10 ループ
   │   - tool_calls が空になるまで継続
   ▼
[Finalize]   ← 結果整形、agent-tasks 更新（status=completed）
   │
   ▼
[Notify]     ← pairpanel + Alexa Reminders に POST
   │
   ▼
[End]

エラー時は [Catch] → agent-tasks (status=failed) → 通知
```

---

## 6. 通知システム（C-10）

### 6.1 トリガー一覧

| 種類 | 例 | スケジュール / 条件 | 優先度 |
|---|---|---|---|
| 定時ブリーフィング | 朝の天気・予定・服装 | 平日 7:00 (EventBridge cron) | Mid |
| 雨予報リマインド | 「今日午後雨」 | 朝の天気取得後、降水確率 > 60% で発火 | High |
| 非同期タスク完了 | 「旅行候補出ました」 | Step Functions 完了時 | Mid |
| 緊急（将来） | 異常検知・大きなカレンダー変更 | 条件成立時 | Critical |

Phase 1 ではこの 3 トリガー（緊急除く）を実装。

### 6.2 配信先

#### pairpanel ダッシュボード（主）

**新エンドポイント**: `POST /api/v1/notifications`

```typescript
interface NotificationPayload {
  kind: "briefing" | "reminder" | "task-result" | "alert";
  title: string;
  body: string;             // markdown 可
  severity: "low" | "mid" | "high" | "critical";
  actions?: Array<{         // Phase 2 で使用
    label: string;
    href?: string;
    callbackToken?: string; // Step Functions 用
  }>;
  payload?: object;         // 構造化データ（task result 詳細など）
  expiresAt?: string;       // ISO8601 自動消滅時刻
}
```

ヘッダー: 既存 pairpanel API と同じ `X-Api-Key / X-User-Id / X-Pair-Id`

#### Alexa Reminders API（副）

Proactive Events API ではなく **Reminders API** を使う：
- 理由: テンプレート制約がない、自由文を読み上げできる、実装簡単
- 認可: LaunchRequest 時 or 朝のセッションで `RequestEnvelope` を投げて Reminders 権限を要求
- 体験: LED 黄色 → ユーザーが「アレクサ、通知は？」 or 「アレクサ、リマインダーは？」で読み上げ

#### Quiet Hours

- 22:00 〜 7:00 は pairpanel には貯まるが Alexa Reminders には POST しない
- `critical` のみ突き抜けて配信

### 6.3 Notification Dispatcher

新ファイル: `lambda/src/services/notificationDispatcher.ts`

```typescript
export interface DispatchOptions {
  channels: Array<"pairpanel" | "alexa-reminder">;
  notification: NotificationPayload;
  respectQuietHours: boolean;
}

export async function dispatch(opts: DispatchOptions): Promise<void>;
```

責務:
- 各チャネルへの送信
- Quiet hours 判定
- 重複抑制（同じ kind+title が直近 1h 以内に送られていたら抑制）
- 失敗時のリトライ（1 回まで）

---

## 7. 承認フロー（リスク階層）

### 7.1 リスク分類

ツール定義に `riskLevel` を必須追加：

| Risk | 動作 | 対象例 |
|---|---|---|
| **low** | 確認なし | 予定取得、天気、Web 調査、買い物リスト追加 |
| **mid** | インライン確認（reprompt） | カレンダー追加、SwitchBot ON/OFF・温度、買い物完了/全削除 |
| **high** | pairpanel 承認 UI（Phase 2 で実装） | Slack 送信、購買、複数日にわたる予定変更 |

Phase 1 では **high** ツールは「自動拒否（システムプロンプトで「実行できません」と返させる）」運用にして、Phase 2 で `request_approval` を実装。

### 7.2 Mid のインライン確認

システムプロンプト追記：

> mid 以上のリスクのツールを実行する前は、必ず「○○しますがよろしいですか？」とユーザーに確認し、肯定応答を得てから実行すること。

Alexa の `reprompt` でセッションを維持し、次の発話で「はい」「OK」を受けて実行。

実装上は、ツール定義のメタデータを起点に LLM が自分で判断する形（コード側に確認ロジックを書かない）。

### 7.3 ツール定義変更例

```typescript
{
  type: "function",
  name: "add_calendar_event",
  description: "Google カレンダーに予定を追加する",
  parameters: { /* ... */ },
  // 新規追加（OpenAI のスキーマには無いので custom prop or system prompt 経由で扱う）
}

// system prompt に挿入
"ツールのリスク分類:\n" +
"- low（確認不要）: get_today_events, get_weather, research_web, ...\n" +
"- mid（実行前確認必須）: add_calendar_event, turn_on_device, turn_off_device, set_ac_temperature, set_ac_mode, complete_all_shopping, ...\n" +
"- high（実行禁止、できないと答える）: send_slack_message, ...\n"
```

OpenAI スキーマに raw メタデータを持たせると壊れるので、**システムプロンプトで分類を共有** が現実的。

---

## 8. MVP スコープ（Phase 1）

### 8.1 含めるもの

#### コード変更（lambda 側）

- 新ツール: `make_plan` / `defer_to_async`（`request_approval` は定義だけして Phase 2 で発火）
- システムプロンプトにリスク階層・確認ルールを追加
- `MAX_TOOL_ROUNDS` 拡張（3 → 5、計画モード時は 8）
- 同期 Lambda 内で実行時間監視（25 秒超で defer_to_async に切替）
- `notificationDispatcher.ts` 追加
- Lambda 用に Step Functions invoke 用の IAM 権限追加

#### 新規 AWS リソース

- DynamoDB テーブル `agent-tasks`（PK: taskId）
- Step Functions State Machine `chappie-async-agent`
- EventBridge ルール 2 つ（朝ブリーフィング、雨予報チェック）
- Lambda 関数 `chappie-async-runner`（Step Functions から呼ばれる）

#### pairpanel 側変更

- 新 API: `POST /api/v1/notifications`（および GET `/api/v1/notifications`）
- pairpanel-frontend に Notification カード UI
- DynamoDB テーブル `notifications`（pairpanel 側、cardId / pairId / kind / ...）

#### Alexa 設定

- スキルマニフェスト更新: Reminders API 権限要求
- LaunchRequest で初回権限案内 / プロンプト

### 8.2 含めないもの（Phase 2 / 3 へ）

- per-user メモリ（健 / 奈緒区別）
- 異常検知（SwitchBot メトリクス監視）
- 夜のまとめ
- カレンダー変更検知
- pairpanel 承認 UI
- ベクトル記憶
- ブラウザ自動化
- Echo Show APL

---

## 9. 実装方針 / リスク

### 9.1 主要リスク

| リスク | 影響 | 対応 |
|---|---|---|
| Step Functions の学習コスト | 開発スローダウン | まず最小ステートマシンで動かす（State 3 つ程度）。CDK ではなく手動 or ASL JSON で開始 |
| Reminders API の権限要求が UX 阻害 | ユーザー離脱 | LaunchRequest で初回案内し、拒否されても通常機能は維持 |
| 非同期タスクの通知タイミング | 寝てる間に LED 点滅 | Quiet hours を厳守、`critical` のみ突き抜け |
| LLM が `make_plan` を不適切に多用 | コスト増 | システムプロンプトで「3 ステップ以上必要なときのみ」と明示。ログで監視 |
| pairpanel API 拡張が pairpanel-cdk 側修正必要 | スコープ拡大 | pairpanel-frontend と pairpanel-cdk の PR を別立てで先行する |
| Lambda 同期側の応答遅延 | 「待っててね」体験悪化 | progressive response を強化（既存実装） |

### 9.2 既存コードとの差分（影響範囲）

主に変更されるファイル:

- `lambda/src/services/openai.ts`（chat 関数、ツール定義、システムプロンプト）
- `lambda/src/services/tools/`（新ツール追加）
- `lambda/src/services/notificationDispatcher.ts`（新規）
- `lambda/src/services/asyncTaskClient.ts`（新規、Step Functions の StartExecution を呼ぶ）
- `lambda/src/services/pairpanel.ts`（通知 POST 関数追加）
- `lambda/src/handlers/ChatIntentHandler.ts`（軽微：エスカレーション結果のハンドリング）
- `lambda/src/handlers/LaunchRequestHandler.ts`（Reminders 権限案内）
- 新規: `async-runner` Lambda（Step Functions から呼ばれる）
- `skill-package/skill.json`（permissions: reminders:write）

新規 AWS リソースは Terraform / CDK 化を Phase 1 中に検討（現状の手動 ASK deploy + 手動 console 操作との折り合い）。

### 9.3 検証・テスト

- 既存 `__tests__/` を踏襲。新ツールには unit test
- Step Functions ローカル実行（`step-functions-local`）でステートマシンの遷移確認
- Alexa Developer Console のシミュレータで Reminders 権限フローを確認
- pairpanel ダッシュボードの通知表示は E2E（ブラウザ）で確認

---

## 10. オープン質問

実装に入る前に決めたい：

- [ ] Step Functions のデプロイ方法（手動 ASL / SAM / CDK / Terraform のどれ？既存スタックとの整合）
- [ ] `agent-tasks` テーブル名のプレフィクス（既存 `alexa-chatgpt-memory` に合わせるか）
- [ ] Reminders API の権限を拒否されたときの「劣化体験」設計（pairpanel だけで運用？）
- [ ] 朝のブリーフィング cron は健・奈緒個別に時間ずらすか、家庭単位で 1 本か
- [ ] pairpanel-cdk / pairpanel-frontend のリポジトリ別々なので、PR 順序とリリース計画
- [ ] OpenAI コストの月予算上限とアラート

---

## 11. Phase 2 / 3 ロードマップ（参考）

### Phase 2

- per-user メモリ（健 / 奈緒）— 起動フレーズ別 or 自己申告ベース
- SwitchBot 異常検知 → 通知
- 夜のまとめ（21:00）
- カレンダー変更検知（差分通知）
- pairpanel 承認 UI（`request_approval` 発火）
- 記念日 / 誕生日リマインダー

### Phase 3

- ベクトル記憶（OpenSearch / pgvector）
- ブラウザ自動化（Playwright on ECS or Lambda Container）
- Echo Show APL（マルチモーダル）
- 旅行 / 予定提案ジェネレーター（複合エージェント）
- Realtime API（低遅延会話）

---

## 12. 次のステップ

1. このスペックをユーザーがレビューし承認
2. `writing-plans` スキルで Phase 1 の実装プラン（タスク分割・順序・依存）を作成
3. pairpanel-cdk / pairpanel-frontend 側の作業見積もり
4. 実装開始

