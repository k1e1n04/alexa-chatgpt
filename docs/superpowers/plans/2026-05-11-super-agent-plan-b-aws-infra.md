# Super Agent Plan B: AWS Async Infrastructure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 非同期エージェント実行基盤（DynamoDB + Step Functions）と定時通知（EventBridge cron）を STG 環境に構築し、Plan A の stub を本物の実装に差し替える。

**Architecture:** 新規 Lambda 2 つ（`chappie-stg-async-runner` / `chappie-stg-morning-briefing`）を独立デプロイし、Step Functions State Machine と EventBridge cron ルールで制御する。通知配信は pairpanel（PRD API）を主チャネルとし、Alexa 側は次回起動時の LaunchRequest で "pending task あり" を読み上げることで代替する。

**Tech Stack:** TypeScript, Node.js 20, @aws-sdk/client-sfn, @aws-sdk/client-dynamodb, AWS Lambda, Step Functions, DynamoDB, EventBridge (all STG, ap-northeast-1)

**環境制約:**
- STG 専用（個人 PJ）— アカウント `939071265855`、リージョン `ap-northeast-1`
- pairpanel API は PRD（`PAIRPANEL_API_URL` = PRD URL）
- Alexa Reminders API は Alexa セッション内でのみ呼び出し可能なため、cron 通知は pairpanel 専用。非同期タスク完了は次回 LaunchRequest で告知する方式を採用する

**前提（Plan A 完了済み）:**
- `lambda/src/services/asyncTaskClient.ts` — stub 実装済み
- `lambda/src/services/notificationDispatcher.ts` — pairpanel POST stub 済み

---

## ファイル構成

| 操作 | ファイルパス | 役割 |
|---|---|---|
| 変更 | `lambda/package.json` | `@aws-sdk/client-sfn` 追加・ビルドスクリプト拡張 |
| 変更 | `lambda/src/services/asyncTaskClient.ts` | stub → DynamoDB + Step Functions 本実装 |
| 新規 | `lambda/src/asyncRunner.ts` | Step Functions から呼ばれる非同期エージェント実行 Lambda ハンドラ |
| 新規 | `lambda/src/morningBriefingRunner.ts` | EventBridge cron から呼ばれる朝ブリーフィング Lambda ハンドラ |
| 変更 | `lambda/src/handlers/LaunchRequestHandler.ts` | 起動時に完了済み pending タスクを読み上げる |

AWS リソース（AWS CLI で作成、コードなし）:
- DynamoDB テーブル `chappie-stg-agent-tasks`
- Lambda 関数 `chappie-stg-async-runner`
- Lambda 関数 `chappie-stg-morning-briefing`
- Step Functions ステートマシン `chappie-stg-async-agent`
- EventBridge cron ルール `chappie-stg-morning-briefing-rule`

---

## Task 1: パッケージ追加とビルドスクリプト拡張

**Files:**
- Modify: `lambda/package.json`

- [ ] **Step 1-1: @aws-sdk/client-sfn を追加する**

```bash
cd lambda && npm install @aws-sdk/client-sfn
```

Expected: `package.json` と `package-lock.json` が更新される

- [ ] **Step 1-2: ビルドスクリプトを拡張して 3 つの entry point を出力する**

`lambda/package.json` の `scripts.build` を以下に変更する:

変更前:
```json
"build": "esbuild src/index.ts --bundle --platform=node --target=node20 --outfile=index.js --minify --external:@aws-sdk/*"
```

変更後:
```json
"build": "esbuild src/index.ts --bundle --platform=node --target=node20 --outfile=index.js --minify --external:@aws-sdk/* && esbuild src/asyncRunner.ts --bundle --platform=node --target=node20 --outfile=async-runner.js --minify --external:@aws-sdk/* && esbuild src/morningBriefingRunner.ts --bundle --platform=node --target=node20 --outfile=morning-briefing-runner.js --minify --external:@aws-sdk/*"
```

`build:dev` も同様に変更する:
```json
"build:dev": "esbuild src/index.ts --bundle --platform=node --target=node20 --outfile=index.js --external:@aws-sdk/* && esbuild src/asyncRunner.ts --bundle --platform=node --target=node20 --outfile=async-runner.js --external:@aws-sdk/* && esbuild src/morningBriefingRunner.ts --bundle --platform=node --target=node20 --outfile=morning-briefing-runner.js --external:@aws-sdk/*"
```

- [ ] **Step 1-3: コミット**

```bash
git add lambda/package.json lambda/package-lock.json
git commit -m "build: add @aws-sdk/client-sfn and multi-entry build script"
```

---

## Task 2: DynamoDB agent-tasks テーブルを STG に作成する

- [ ] **Step 2-1: テーブルを作成する**

```bash
aws dynamodb create-table \
  --table-name chappie-stg-agent-tasks \
  --attribute-definitions \
    AttributeName=taskId,AttributeType=S \
    AttributeName=userId,AttributeType=S \
  --key-schema \
    AttributeName=taskId,KeyType=HASH \
  --global-secondary-indexes '[{
    "IndexName": "userId-createdAt-index",
    "KeySchema": [
      {"AttributeName": "userId", "KeyType": "HASH"}
    ],
    "Projection": {"ProjectionType": "ALL"}
  }]' \
  --billing-mode PAY_PER_REQUEST \
  --region ap-northeast-1 \
  --profile stg
```

Expected: テーブル `chappie-stg-agent-tasks` が `CREATING` → `ACTIVE` になる

- [ ] **Step 2-2: TTL を設定する（30 日自動削除）**

```bash
aws dynamodb update-time-to-live \
  --table-name chappie-stg-agent-tasks \
  --time-to-live-specification "Enabled=true, AttributeName=ttl" \
  --region ap-northeast-1 \
  --profile stg
```

- [ ] **Step 2-3: テーブルが作成されたことを確認する**

```bash
aws dynamodb describe-table \
  --table-name chappie-stg-agent-tasks \
  --region ap-northeast-1 \
  --profile stg \
  --query "Table.TableStatus"
```

Expected: `"ACTIVE"`

---

## Task 3: asyncTaskClient.ts を本実装に差し替える

**Files:**
- Modify: `lambda/src/services/asyncTaskClient.ts`

- [ ] **Step 3-1: asyncTaskClient.ts を以下の本実装に書き換える**

```typescript
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand, UpdateCommand, GetCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { SFNClient, StartExecutionCommand } from "@aws-sdk/client-sfn";

const REGION = process.env.AWS_REGION ?? "ap-northeast-1";
const TABLE_NAME = process.env.AGENT_TASKS_TABLE ?? "chappie-stg-agent-tasks";
const STATE_MACHINE_ARN = process.env.ASYNC_AGENT_STATE_MACHINE_ARN ?? "";

const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));
const sfn = new SFNClient({ region: REGION });

export type TaskStatus = "pending" | "running" | "completed" | "failed";

export interface AgentTask {
  taskId: string;
  userId: string;
  goal: string;
  plan: string[];
  status: TaskStatus;
  result?: string;
  createdAt: string;
  completedAt?: string;
  error?: string;
  ttl: number;
  notified?: boolean;
}

export async function createAsyncTask(
  userId: string,
  goal: string,
  plan: string[],
): Promise<{ taskId: string }> {
  const taskId = `task-${Date.now()}`;
  const createdAt = new Date().toISOString();
  const ttl = Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60; // 30 days

  await dynamo.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: { taskId, userId, goal, plan, status: "pending", createdAt, ttl },
    }),
  );

  if (STATE_MACHINE_ARN) {
    await sfn.send(
      new StartExecutionCommand({
        stateMachineArn: STATE_MACHINE_ARN,
        name: taskId,
        input: JSON.stringify({ taskId, userId, goal, plan }),
      }),
    );
  } else {
    console.warn("[async-task] ASYNC_AGENT_STATE_MACHINE_ARN not set — skipping Step Functions");
  }

  console.info("[async-task] created", { taskId, userId, goal });
  return { taskId };
}

export async function updateTaskStatus(
  taskId: string,
  status: TaskStatus,
  result?: string,
  error?: string,
): Promise<void> {
  const completedAt = status === "completed" || status === "failed"
    ? new Date().toISOString()
    : undefined;

  await dynamo.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { taskId },
      UpdateExpression:
        "SET #s = :s" +
        (result !== undefined ? ", #r = :r" : "") +
        (error !== undefined ? ", #e = :e" : "") +
        (completedAt ? ", completedAt = :ca" : ""),
      ExpressionAttributeNames: {
        "#s": "status",
        ...(result !== undefined ? { "#r": "result" } : {}),
        ...(error !== undefined ? { "#e": "error" } : {}),
      },
      ExpressionAttributeValues: {
        ":s": status,
        ...(result !== undefined ? { ":r": result } : {}),
        ...(error !== undefined ? { ":e": error } : {}),
        ...(completedAt ? { ":ca": completedAt } : {}),
      },
    }),
  );
}

export async function getTask(taskId: string): Promise<AgentTask | null> {
  const res = await dynamo.send(
    new GetCommand({ TableName: TABLE_NAME, Key: { taskId } }),
  );
  return (res.Item as AgentTask) ?? null;
}

export async function getPendingCompletedTasks(userId: string): Promise<AgentTask[]> {
  const res = await dynamo.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      IndexName: "userId-createdAt-index",
      KeyConditionExpression: "userId = :uid",
      FilterExpression: "#s = :s AND (attribute_not_exists(notified) OR notified = :f)",
      ExpressionAttributeNames: { "#s": "status" },
      ExpressionAttributeValues: { ":uid": userId, ":s": "completed", ":f": false },
      Limit: 5,
    }),
  );
  return (res.Items ?? []) as AgentTask[];
}

export async function markTaskNotified(taskId: string): Promise<void> {
  await dynamo.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { taskId },
      UpdateExpression: "SET notified = :t",
      ExpressionAttributeValues: { ":t": true },
    }),
  );
}
```

- [ ] **Step 3-2: ビルドエラーがないことを確認する**

```bash
cd lambda && npx tsc --noEmit
```

Expected: エラーなし

- [ ] **Step 3-3: コミット**

```bash
git add lambda/src/services/asyncTaskClient.ts
git commit -m "feat: replace async task client stub with DynamoDB + Step Functions"
```

---

## Task 4: asyncRunner Lambda ハンドラを実装する

**Files:**
- Create: `lambda/src/asyncRunner.ts`

- [ ] **Step 4-1: asyncRunner.ts を作成する**

```typescript
import { chat } from "./services/openai";
import { dispatch } from "./services/notificationDispatcher";
import { updateTaskStatus } from "./services/asyncTaskClient";

interface AsyncRunnerEvent {
  taskId: string;
  userId: string;
  goal: string;
  plan: string[];
}

export const handler = async (event: AsyncRunnerEvent): Promise<void> => {
  const { taskId, userId, goal } = event;

  await updateTaskStatus(taskId, "running");
  console.info("[async-runner] start", { taskId, goal });

  try {
    // Plan A で拡張された chat() を呼ぶ（make_plan/defer_to_async は再発火しない前提）
    const result = await chat(goal, undefined, undefined, userId);

    await updateTaskStatus(taskId, "completed", result.text);
    console.info("[async-runner] completed", { taskId });

    const shortGoal = goal.length > 25 ? `${goal.slice(0, 25)}…` : goal;
    await dispatch({
      channels: ["pairpanel"],
      notification: {
        kind: "task-result",
        title: `完了: ${shortGoal}`,
        body: result.text,
        severity: "mid",
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      },
      respectQuietHours: true,
    });
  } catch (err) {
    const errMsg = String(err);
    await updateTaskStatus(taskId, "failed", undefined, errMsg);
    console.error("[async-runner] failed", { taskId, err: errMsg });

    await dispatch({
      channels: ["pairpanel"],
      notification: {
        kind: "alert",
        title: "エラー",
        body: `「${goal}」の処理に失敗しました。`,
        severity: "high",
      },
      respectQuietHours: false,
    });
  }
};
```

- [ ] **Step 4-2: コミット**

```bash
git add lambda/src/asyncRunner.ts
git commit -m "feat: add async runner Lambda handler"
```

---

## Task 5: morningBriefingRunner Lambda ハンドラを実装する

**Files:**
- Create: `lambda/src/morningBriefingRunner.ts`

- [ ] **Step 5-1: morningBriefingRunner.ts を作成する**

```typescript
import { getBriefingData, buildBriefingContext } from "./services/briefing";
import { chat } from "./services/openai";
import { dispatch } from "./services/notificationDispatcher";

export const handler = async (): Promise<void> => {
  console.info("[morning-briefing] start");

  let briefingData;
  try {
    briefingData = await getBriefingData();
  } catch (err) {
    console.error("[morning-briefing] getBriefingData failed", err);
    return;
  }

  const contextData = buildBriefingContext(briefingData);

  let result;
  try {
    result = await chat(
      "今日のブリーフィングをお願いします。天気と予定を読み上げ、今日の気温に合わせた服装アドバイスも教えてください。",
      undefined,
      contextData,
      "morning-cron",
    );
  } catch (err) {
    console.error("[morning-briefing] chat failed", err);
    return;
  }

  const tomorrow = new Date(Date.now() + 20 * 60 * 60 * 1000).toISOString(); // 20h 後に期限
  await dispatch({
    channels: ["pairpanel"],
    notification: {
      kind: "briefing",
      title: "朝のブリーフィング",
      body: result.text,
      severity: "low",
      expiresAt: tomorrow,
    },
    respectQuietHours: false,
  });

  // 雨予報チェック（description に "雨" or "にわか雨" を含む場合）
  const desc = briefingData.weather?.description ?? "";
  if (desc.includes("雨") && !desc.includes("快晴") && !desc.includes("晴")) {
    await dispatch({
      channels: ["pairpanel"],
      notification: {
        kind: "reminder",
        title: "☂ 雨予報",
        body: `今日は${desc}。お出かけの際は傘をお忘れなく。`,
        severity: "mid",
        expiresAt: tomorrow,
      },
      respectQuietHours: false,
    });
  }

  console.info("[morning-briefing] done");
};
```

- [ ] **Step 5-2: コミット**

```bash
git add lambda/src/morningBriefingRunner.ts
git commit -m "feat: add morning briefing runner Lambda handler"
```

---

## Task 6: LaunchRequestHandler に pending タスク告知を追加する

**Files:**
- Modify: `lambda/src/handlers/LaunchRequestHandler.ts`

- [ ] **Step 6-1: LaunchRequestHandler の handle() を更新する**

ファイル先頭の import 群に追加:

```typescript
import { getPendingCompletedTasks, markTaskNotified } from "../services/asyncTaskClient";
```

`handle()` メソッド内、memory 取得の後（`if (memory) { ... }` の後）に以下を追加する:

```typescript
// 完了済み未通知タスクがあれば告知する
let pendingTasks: Awaited<ReturnType<typeof getPendingCompletedTasks>> = [];
try {
  pendingTasks = await getPendingCompletedTasks(userId);
} catch (err) {
  console.warn("[launch] getPendingCompletedTasks failed", err);
}
```

return 文の `speechText` 組み立て部分を変更する（Plan A で追加した Reminders チェックと統合）:

変更前:
```typescript
const speechText = hasRemindersPermission
  ? "はい、どうぞ。"
  : "はい、どうぞ。通知機能を有効にするには、Alexaアプリからリマインダーの権限を許可してください。";
```

変更後:
```typescript
let speechText: string;
if (pendingTasks.length > 0) {
  const taskList = pendingTasks.map((t) => `「${t.goal.slice(0, 20)}」`).join("、");
  speechText = `はい、どうぞ。さっきお願いした${taskList}の件が完了しています。確認しますか？`;
  // 通知済みにマークする（非同期、エラーは無視）
  Promise.allSettled(pendingTasks.map((t) => markTaskNotified(t.taskId))).catch(() => {});
} else if (!hasRemindersPermission) {
  speechText = "はい、どうぞ。通知機能を有効にするには、Alexaアプリからリマインダーの権限を許可してください。";
} else {
  speechText = "はい、どうぞ。";
}
```

- [ ] **Step 6-2: ビルドエラーがないことを確認する**

```bash
cd lambda && npx tsc --noEmit
```

Expected: エラーなし

- [ ] **Step 6-3: コミット**

```bash
git add lambda/src/handlers/LaunchRequestHandler.ts
git commit -m "feat: announce pending completed tasks on launch"
```

---

## Task 7: Lambda 関数を STG に作成・デプロイする

- [ ] **Step 7-1: ビルドする**

```bash
cd lambda && npm run build
```

Expected: `index.js` / `async-runner.js` / `morning-briefing-runner.js` が生成される

- [ ] **Step 7-2: async-runner Lambda を作成する（初回のみ）**

まず Lambda 実行ロール ARN を確認する（既存の Alexa Lambda と同じロールを使用）:

```bash
aws lambda get-function-configuration \
  --function-name ask-gpt-stg-default-1778390136821 \
  --region ap-northeast-1 \
  --profile stg \
  --query "Role"
```

取得した Role ARN を `ROLE_ARN` に置き換えて実行:

```bash
cd lambda
zip async-runner.zip async-runner.js
aws lambda create-function \
  --function-name chappie-stg-async-runner \
  --runtime nodejs20.x \
  --role ROLE_ARN \
  --handler async-runner.handler \
  --zip-file fileb://async-runner.zip \
  --timeout 120 \
  --memory-size 512 \
  --region ap-northeast-1 \
  --profile stg
```

- [ ] **Step 7-3: morning-briefing Lambda を作成する（初回のみ）**

```bash
cd lambda
zip morning-briefing.zip morning-briefing-runner.js
aws lambda create-function \
  --function-name chappie-stg-morning-briefing \
  --runtime nodejs20.x \
  --role ROLE_ARN \
  --handler morning-briefing-runner.handler \
  --zip-file fileb://morning-briefing.zip \
  --timeout 60 \
  --memory-size 256 \
  --region ap-northeast-1 \
  --profile stg
```

- [ ] **Step 7-4: 両 Lambda に環境変数を設定する**

`chappie-stg-async-runner` に設定（既存 Alexa Lambda と同じ値を使う）:

```bash
aws lambda update-function-configuration \
  --function-name chappie-stg-async-runner \
  --environment "Variables={
    OPENAI_API_KEY=...,
    OPENAI_MODEL=gpt-4.1-mini,
    GEMINI_API_KEY=...,
    PAIRPANEL_API_URL=...,
    PAIRPANEL_API_GATEWAY_KEY=...,
    PAIRPANEL_USER_ID=...,
    PAIRPANEL_PAIR_ID=...,
    MEMORY_TABLE_NAME=alexa-chatgpt-memory,
    AGENT_TASKS_TABLE=chappie-stg-agent-tasks,
    GOOGLE_OAUTH_CLIENT_ID=...,
    GOOGLE_OAUTH_CLIENT_SECRET=...,
    GOOGLE_OAUTH_REFRESH_TOKEN=...
  }" \
  --region ap-northeast-1 \
  --profile stg
```

`chappie-stg-morning-briefing` にも同様に設定する（`ASYNC_AGENT_STATE_MACHINE_ARN` は不要）。

- [ ] **Step 7-5: 既存の Alexa Lambda にも AGENT_TASKS_TABLE と STATE_MACHINE_ARN を追加する**

```bash
aws lambda update-function-configuration \
  --function-name ask-gpt-stg-default-1778390136821 \
  --environment "Variables={
    ...(既存の全変数をそのまま残す)...,
    AGENT_TASKS_TABLE=chappie-stg-agent-tasks,
    ASYNC_AGENT_STATE_MACHINE_ARN=arn:aws:states:ap-northeast-1:939071265855:stateMachine:chappie-stg-async-agent
  }" \
  --region ap-northeast-1 \
  --profile stg
```

---

## Task 8: Step Functions ステートマシンを作成する

- [ ] **Step 8-1: ステートマシン定義ファイルを作成する**

`/tmp/chappie-async-agent.json` を作成する（`ACCOUNT` は `939071265855`）:

```json
{
  "Comment": "Chappie async agent — runs long tasks and notifies on completion",
  "StartAt": "RunAgent",
  "States": {
    "RunAgent": {
      "Type": "Task",
      "Resource": "arn:aws:lambda:ap-northeast-1:939071265855:function:chappie-stg-async-runner",
      "TimeoutSeconds": 300,
      "Retry": [
        {
          "ErrorEquals": ["Lambda.ServiceException", "Lambda.AWSLambdaException"],
          "IntervalSeconds": 10,
          "MaxAttempts": 2,
          "BackoffRate": 2
        }
      ],
      "Catch": [
        {
          "ErrorEquals": ["States.ALL"],
          "Next": "HandleError",
          "ResultPath": "$.error"
        }
      ],
      "End": true
    },
    "HandleError": {
      "Type": "Task",
      "Resource": "arn:aws:lambda:ap-northeast-1:939071265855:function:chappie-stg-async-runner",
      "Parameters": {
        "taskId.$": "$.taskId",
        "userId.$": "$.userId",
        "goal.$": "$.goal",
        "plan.$": "$.plan",
        "forceFail": true
      },
      "End": true
    }
  }
}
```

- [ ] **Step 8-2: ステートマシンを作成する**

Step Functions 用 IAM ロールの ARN を確認（or 新規作成）する。以下は新規作成の場合:

```bash
# Step Functions が Lambda を呼べるロールを作成
aws iam create-role \
  --role-name chappie-stg-sfn-role \
  --assume-role-policy-document '{
    "Version": "2012-10-17",
    "Statement": [{
      "Effect": "Allow",
      "Principal": {"Service": "states.amazonaws.com"},
      "Action": "sts:AssumeRole"
    }]
  }' \
  --profile stg

aws iam attach-role-policy \
  --role-name chappie-stg-sfn-role \
  --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaRole \
  --profile stg
```

```bash
aws stepfunctions create-state-machine \
  --name chappie-stg-async-agent \
  --definition file:///tmp/chappie-async-agent.json \
  --role-arn arn:aws:iam::939071265855:role/chappie-stg-sfn-role \
  --region ap-northeast-1 \
  --profile stg
```

取得した ARN を手元にメモしておく（環境変数に設定するため）。

- [ ] **Step 8-3: Alexa Lambda の環境変数に ASYNC_AGENT_STATE_MACHINE_ARN を追加する（Task 7-5 で未設定の場合）**

```bash
# 現在の環境変数を確認
aws lambda get-function-configuration \
  --function-name ask-gpt-stg-default-1778390136821 \
  --region ap-northeast-1 \
  --profile stg \
  --query "Environment.Variables"
# → 上記で確認した全変数 + ASYNC_AGENT_STATE_MACHINE_ARN を update-function-configuration で設定
```

---

## Task 9: EventBridge cron ルールを設定する

- [ ] **Step 9-1: 朝ブリーフィングルールを作成する（平日 7:00 JST = UTC 月〜金 22:00 前日）**

EventBridge cron は UTC なのだ。JST 7:00 = UTC 22:00 前日。平日 JST（月〜金）= UTC 日〜木（Sun-Thu）。

```bash
# EventBridge ルール作成
aws events put-rule \
  --name chappie-stg-morning-briefing-rule \
  --schedule-expression "cron(0 22 ? * SUN-THU *)" \
  --state ENABLED \
  --region ap-northeast-1 \
  --profile stg

# Lambda 実行権限を EventBridge に付与
aws lambda add-permission \
  --function-name chappie-stg-morning-briefing \
  --statement-id chappie-stg-morning-briefing-events \
  --action lambda:InvokeFunction \
  --principal events.amazonaws.com \
  --source-arn arn:aws:events:ap-northeast-1:939071265855:rule/chappie-stg-morning-briefing-rule \
  --region ap-northeast-1 \
  --profile stg

# ターゲットに Lambda を設定
aws events put-targets \
  --rule chappie-stg-morning-briefing-rule \
  --targets '[{
    "Id": "chappie-morning-briefing",
    "Arn": "arn:aws:lambda:ap-northeast-1:939071265855:function:chappie-stg-morning-briefing"
  }]' \
  --region ap-northeast-1 \
  --profile stg
```

- [ ] **Step 9-2: テスト実行（手動 invoke で動作確認）**

```bash
aws lambda invoke \
  --function-name chappie-stg-morning-briefing \
  --region ap-northeast-1 \
  --profile stg \
  /tmp/morning-briefing-result.json && cat /tmp/morning-briefing-result.json
```

Expected: `{}` (void return) でエラーなし。CloudWatch ログに `[morning-briefing] done` が出る。

pairpanel ダッシュボードに「朝のブリーフィング」カードが出ていれば完全動作確認（Plan C 完了後）。

---

## Task 10: Lambda IAM ロールに DynamoDB / Step Functions 権限を追加する

- [ ] **Step 10-1: 既存 Lambda ロールに agent-tasks テーブルへのアクセス権を追加する**

既存ロール名を確認する:

```bash
aws lambda get-function-configuration \
  --function-name ask-gpt-stg-default-1778390136821 \
  --region ap-northeast-1 \
  --profile stg \
  --query "Role"
```

ロール名（ARN の末尾部分）を確認して適宜変更しながら実行する:

```bash
# インラインポリシーで DynamoDB + SFN 権限を追加
aws iam put-role-policy \
  --role-name EXISTING_ROLE_NAME \
  --policy-name chappie-agent-tasks-policy \
  --policy-document '{
    "Version": "2012-10-17",
    "Statement": [
      {
        "Effect": "Allow",
        "Action": [
          "dynamodb:PutItem",
          "dynamodb:GetItem",
          "dynamodb:UpdateItem",
          "dynamodb:Query"
        ],
        "Resource": [
          "arn:aws:dynamodb:ap-northeast-1:939071265855:table/chappie-stg-agent-tasks",
          "arn:aws:dynamodb:ap-northeast-1:939071265855:table/chappie-stg-agent-tasks/index/*"
        ]
      },
      {
        "Effect": "Allow",
        "Action": "states:StartExecution",
        "Resource": "arn:aws:states:ap-northeast-1:939071265855:stateMachine:chappie-stg-async-agent"
      }
    ]
  }' \
  --profile stg
```

同じポリシーを `chappie-stg-async-runner` と `chappie-stg-morning-briefing` のロールにも適用する（Step Functions の StartExecution は async-runner には不要）。

---

## Task 11: ビルド・デプロイ・動作確認

- [ ] **Step 11-1: 全テストが通ることを確認する**

```bash
cd lambda && npx vitest run
```

Expected: 全テスト PASS（asyncTaskClient のテストは環境変数なし stub モードで動作する）

- [ ] **Step 11-2: ビルドして全 Lambda をデプロイする**

```bash
cd lambda && npm run build

# Alexa スキル Lambda（既存のデプロイフロー）
cd .. && ask deploy --profile stg --ignore-hash && \
  aws lambda update-function-configuration \
    --function-name ask-gpt-stg-default-1778390136821 \
    --timeout 30 \
    --region ap-northeast-1 \
    --profile stg

# async-runner Lambda
cd lambda
zip async-runner.zip async-runner.js
aws lambda update-function-code \
  --function-name chappie-stg-async-runner \
  --zip-file fileb://async-runner.zip \
  --region ap-northeast-1 \
  --profile stg

# morning-briefing Lambda
zip morning-briefing.zip morning-briefing-runner.js
aws lambda update-function-code \
  --function-name chappie-stg-morning-briefing \
  --zip-file fileb://morning-briefing.zip \
  --region ap-northeast-1 \
  --profile stg
```

- [ ] **Step 11-3: 非同期タスクの E2E テストをする**

Alexa シミュレータまたは実機で発話:

「来週の連休どこか行けそう？予定と天気も調べて候補出して」

期待する動作:
1. 「了解しました。処理が完了したらpairpanelでお知らせします。」と返ってくる
2. CloudWatch で `chappie-stg-async-runner` のログに `[async-runner] start` と `[async-runner] completed` が出る
3. DynamoDB `chappie-stg-agent-tasks` に `status: "completed"` のレコードが入る
4. 次回起動で「さっきお願いした〜の件が完了しています」と告知される

```bash
# DynamoDB でタスク確認
aws dynamodb scan \
  --table-name chappie-stg-agent-tasks \
  --region ap-northeast-1 \
  --profile stg \
  --query "Items[*].{taskId:taskId.S, status:status.S, goal:goal.S}"
```

- [ ] **Step 11-4: 全コミットが済んでいることを確認する**

```bash
git status
```

Expected: クリーンな状態（未コミットの変更なし）
