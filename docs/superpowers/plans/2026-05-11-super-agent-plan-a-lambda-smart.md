# Super Agent Plan A: Lambda Smart Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** チャッピーの Lambda に Plan-Execute エージェントループ・リスク階層確認・通知ディスパッチャーを追加し、「考えて計画して実行する脳」の基盤を作る。

**Architecture:** OpenAI Responses API の既存 ReAct ループを拡張し、`make_plan`（計画宣言）と `defer_to_async`（非同期エスカレーション stub）ツールを追加する。システムプロンプトにリスク分類ルールを組み込み、mid-risk ツールは実行前に確認する。通知ディスパッチャーは pairpanel（PRD API URL 設定済み）と Alexa Reminders（stub）へ配信できる骨組みを作る。Step Functions / DynamoDB 実体は Plan B で実装するため、本プランでは stub 実装で完結させる。

**Tech Stack:** TypeScript, vitest, openai SDK v5, ask-sdk-core, AWS Lambda (STG: `ask-gpt-stg-default-1778390136821`, ap-northeast-1)

**環境制約:**
- Lambda は STG のみ（`--profile stg`）
- pairpanel API は PRD（`PAIRPANEL_API_URL` 環境変数に PRD URL が設定済み）
- DynamoDB / Step Functions は Plan B で追加する。本プランでは呼び出しコードだけ書いて stub 実装にする

---

## ファイル構成

| 操作 | ファイルパス | 役割 |
|---|---|---|
| 新規 | `lambda/src/services/asyncTaskClient.ts` | 非同期タスク作成 stub（Plan B で Step Functions + DynamoDB に差し替え） |
| 新規 | `lambda/src/services/tools/agentTools.ts` | `make_plan` / `defer_to_async` ツール定義 + 実行 |
| 新規 | `lambda/src/services/notificationDispatcher.ts` | pairpanel + Alexa Reminders へ通知配信 |
| 新規 | `lambda/src/services/__tests__/asyncTaskClient.test.ts` | asyncTaskClient の単体テスト |
| 新規 | `lambda/src/services/__tests__/agentTools.test.ts` | agentTools の単体テスト |
| 新規 | `lambda/src/services/__tests__/notificationDispatcher.test.ts` | notificationDispatcher の単体テスト |
| 変更 | `lambda/src/services/pairpanel.ts` | `postNotification()` 関数を追加 |
| 変更 | `lambda/src/services/openai.ts` | システムプロンプト更新・agentTools 組み込み・ラウンド拡張・タイミング検出・userId 引数追加 |
| 変更 | `lambda/src/handlers/ChatIntentHandler.ts` | userId を `chat()` に渡す |
| 変更 | `lambda/src/handlers/LaunchRequestHandler.ts` | Reminders API 権限リクエスト |
| 変更 | `skill-package/skill.json` | `alexa::alerts:reminders:skill:readwrite` 権限追加 |

---

## Task 1: asyncTaskClient stub

**Files:**
- Create: `lambda/src/services/asyncTaskClient.ts`
- Create: `lambda/src/services/__tests__/asyncTaskClient.test.ts`

- [ ] **Step 1-1: テストを書く**

`lambda/src/services/__tests__/asyncTaskClient.test.ts` を作成する:

```typescript
import { describe, it, expect, vi } from "vitest";
import { createAsyncTask } from "../asyncTaskClient";

describe("createAsyncTask", () => {
  it("task- プレフィクスのついた taskId を返す", async () => {
    const { taskId } = await createAsyncTask("user123", "テスト目的", ["ステップ1"]);
    expect(taskId).toMatch(/^task-\d+$/);
  });

  it("タスク生成時に console.info でログを出す", async () => {
    const spy = vi.spyOn(console, "info").mockImplementation(() => {});
    await createAsyncTask("user123", "テスト", ["ステップ1"]);
    expect(spy).toHaveBeenCalledWith(
      "[async-task stub] created",
      expect.objectContaining({ userId: "user123", goal: "テスト" }),
    );
    spy.mockRestore();
  });
});
```

- [ ] **Step 1-2: テストが失敗することを確認する**

```bash
cd lambda && npx vitest run src/services/__tests__/asyncTaskClient.test.ts
```

Expected: `FAIL` — `asyncTaskClient` が存在しないエラー

- [ ] **Step 1-3: 実装する**

`lambda/src/services/asyncTaskClient.ts` を作成する:

```typescript
export async function createAsyncTask(
  userId: string,
  goal: string,
  plan: string[],
): Promise<{ taskId: string }> {
  const taskId = `task-${Date.now()}`;
  console.info("[async-task stub] created", { taskId, userId, goal, plan });
  // Plan B: Step Functions の StartExecution + DynamoDB agent-tasks への書き込みに差し替える
  return { taskId };
}
```

- [ ] **Step 1-4: テストが通ることを確認する**

```bash
cd lambda && npx vitest run src/services/__tests__/asyncTaskClient.test.ts
```

Expected: `PASS` (2 tests)

- [ ] **Step 1-5: コミット**

```bash
git add lambda/src/services/asyncTaskClient.ts lambda/src/services/__tests__/asyncTaskClient.test.ts
git commit -m "feat: add async task client stub"
```

---

## Task 2: agentTools.ts (make_plan / defer_to_async)

**Files:**
- Create: `lambda/src/services/tools/agentTools.ts`
- Create: `lambda/src/services/__tests__/agentTools.test.ts`

- [ ] **Step 2-1: テストを書く**

`lambda/src/services/__tests__/agentTools.test.ts` を作成する:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { executeAgentTool, agentToolDefinitions } from "../tools/agentTools";

vi.mock("../asyncTaskClient", () => ({
  createAsyncTask: vi.fn().mockResolvedValue({ taskId: "task-test-123" }),
}));

describe("agentToolDefinitions", () => {
  it("make_plan と defer_to_async の定義を含む", () => {
    const names = agentToolDefinitions.map((t) => t.name);
    expect(names).toContain("make_plan");
    expect(names).toContain("defer_to_async");
  });

  it("make_plan の parameters に goal / steps / estimated_seconds が必須", () => {
    const def = agentToolDefinitions.find((t) => t.name === "make_plan")!;
    expect(def.parameters?.required).toEqual(
      expect.arrayContaining(["goal", "steps", "estimated_seconds"]),
    );
  });
});

describe("executeAgentTool", () => {
  it("make_plan: acknowledged=true と plan- プレフィクスの planId を返す", async () => {
    const result = await executeAgentTool(
      "make_plan",
      { goal: "旅行を計画する", steps: ["予定確認", "天気調査", "候補作成"], estimated_seconds: 15 },
      {},
    );
    const parsed = JSON.parse(result!);
    expect(parsed.acknowledged).toBe(true);
    expect(parsed.planId).toMatch(/^plan-\d+$/);
    expect(typeof parsed.message).toBe("string");
  });

  it("defer_to_async: createAsyncTask を呼び出して taskId を返す", async () => {
    const { createAsyncTask } = await import("../asyncTaskClient");
    const result = await executeAgentTool(
      "defer_to_async",
      {
        goal: "旅行候補を出す",
        plan: ["予定確認", "天気調査", "候補作成"],
        delivery: "both",
      },
      { userId: "amzn1.ask.account.test" },
    );
    const parsed = JSON.parse(result!);
    expect(parsed.taskId).toBe("task-test-123");
    expect(createAsyncTask).toHaveBeenCalledWith(
      "amzn1.ask.account.test",
      "旅行候補を出す",
      ["予定確認", "天気調査", "候補作成"],
    );
  });

  it("未知のツール名には null を返す", async () => {
    const result = await executeAgentTool("unknown_tool", {}, {});
    expect(result).toBeNull();
  });
});
```

- [ ] **Step 2-2: テストが失敗することを確認する**

```bash
cd lambda && npx vitest run src/services/__tests__/agentTools.test.ts
```

Expected: `FAIL` — `agentTools` が存在しないエラー

- [ ] **Step 2-3: 実装する**

`lambda/src/services/tools/agentTools.ts` を作成する:

```typescript
import type OpenAI from "openai";
import { createAsyncTask } from "../asyncTaskClient";

export const agentToolDefinitions: OpenAI.Responses.FunctionTool[] = [
  {
    type: "function",
    name: "make_plan",
    description:
      "ユーザーの依頼が3ステップ以上必要だと判断したときに呼び出す。実行計画を宣言する。" +
      "計画を宣言した後はステップを順番に実行すること。",
    parameters: {
      type: "object",
      properties: {
        goal: { type: "string", description: "最終ゴール（ユーザーに説明できる形）" },
        steps: {
          type: "array",
          items: { type: "string" },
          description: "実行ステップのリスト（3〜8個の自然文）",
        },
        estimated_seconds: { type: "number", description: "推定所要時間（秒）" },
      },
      required: ["goal", "steps", "estimated_seconds"],
    },
  },
  {
    type: "function",
    name: "defer_to_async",
    description:
      "処理が25秒以上かかる見込み、またはステップが6個以上のときに呼び出す。" +
      "処理を非同期に切り替え、完了後にpairpanelとAlexaで通知する。",
    parameters: {
      type: "object",
      properties: {
        goal: { type: "string", description: "依頼の要旨" },
        plan: {
          type: "array",
          items: { type: "string" },
          description: "実行予定のステップリスト",
        },
        delivery: {
          type: "string",
          enum: ["pairpanel", "alexa-reminder", "both"],
          description: "完了通知の配信先",
        },
      },
      required: ["goal", "plan", "delivery"],
    },
  },
];

export interface AgentContext {
  userId?: string;
}

export async function executeAgentTool(
  name: string,
  args: Record<string, unknown>,
  context: AgentContext,
): Promise<string | null> {
  switch (name) {
    case "make_plan": {
      const planId = `plan-${Date.now()}`;
      const steps = args.steps as string[];
      console.info("[make_plan]", { planId, goal: args.goal, steps });
      return JSON.stringify({
        acknowledged: true,
        planId,
        message: `計画を受け付けました（${steps.length}ステップ）。順番に実行します。`,
      });
    }
    case "defer_to_async": {
      const goal = args.goal as string;
      const plan = args.plan as string[];
      const { taskId } = await createAsyncTask(context.userId ?? "unknown", goal, plan);
      console.info("[defer_to_async]", { taskId, goal });
      return JSON.stringify({
        taskId,
        message: "了解しました。処理が完了したらpairpanelとAlexaでお知らせします。",
      });
    }
    default:
      return null;
  }
}
```

- [ ] **Step 2-4: テストが通ることを確認する**

```bash
cd lambda && npx vitest run src/services/__tests__/agentTools.test.ts
```

Expected: `PASS` (5 tests)

- [ ] **Step 2-5: コミット**

```bash
git add lambda/src/services/tools/agentTools.ts lambda/src/services/__tests__/agentTools.test.ts
git commit -m "feat: add make_plan and defer_to_async agent tools"
```

---

## Task 3: pairpanel 通知関数 + notificationDispatcher

**Files:**
- Modify: `lambda/src/services/pairpanel.ts` (`postNotification` 追加)
- Create: `lambda/src/services/notificationDispatcher.ts`
- Create: `lambda/src/services/__tests__/notificationDispatcher.test.ts`

- [ ] **Step 3-1: pairpanel.ts に postNotification stub を追加する**

`lambda/src/services/pairpanel.ts` の末尾に追記する（既存のコードはそのまま）:

```typescript
export interface PairpanelNotification {
  kind: "briefing" | "reminder" | "task-result" | "alert";
  title: string;
  body: string;
  severity: "low" | "mid" | "high" | "critical";
  expiresAt?: string;
}

export async function postNotification(notification: PairpanelNotification): Promise<void> {
  if (!BASE_URL) {
    console.info("[pairpanel-notify] PAIRPANEL_API_URL not set, skipping");
    return;
  }
  const res = await fetch(`${BASE_URL}/api/v1/notifications`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(notification),
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) {
    // Plan C でエンドポイントが実装されるまで 404 は想定内。ログだけ出して続行
    console.warn("[pairpanel-notify] failed:", res.status);
  }
}
```

- [ ] **Step 3-2: notificationDispatcher のテストを書く**

`lambda/src/services/__tests__/notificationDispatcher.test.ts` を作成する:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// pairpanel モジュールを先にモック（import より前に宣言）
vi.mock("../pairpanel", async (importOriginal) => {
  const original = await importOriginal<typeof import("../pairpanel")>();
  return { ...original, postNotification: vi.fn().mockResolvedValue(undefined) };
});

import { dispatch } from "../notificationDispatcher";
import * as pairpanel from "../pairpanel";

describe("dispatch", () => {
  beforeEach(() => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("pairpanel チャンネル: postNotification を呼ぶ", async () => {
    await dispatch({
      channels: ["pairpanel"],
      notification: { kind: "reminder", title: "テスト", body: "本文", severity: "low" },
      respectQuietHours: false,
    });
    expect(pairpanel.postNotification).toHaveBeenCalledOnce();
    expect(pairpanel.postNotification).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "reminder", title: "テスト" }),
    );
  });

  it("alexa-reminder チャンネル: quiet hours 外ならログを出す", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T01:00:00Z")); // 10:00 JST
    const infoSpy = vi.mocked(console.info);

    await dispatch({
      channels: ["alexa-reminder"],
      notification: { kind: "briefing", title: "朝のお知らせ", body: "天気は晴れ", severity: "low" },
      respectQuietHours: true,
    });

    expect(infoSpy).toHaveBeenCalledWith("[alexa-reminder stub]", "朝のお知らせ", "天気は晴れ");
    vi.useRealTimers();
  });

  it("quiet hours 中は alexa-reminder をスキップする（critical 以外）", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T14:00:00Z")); // 23:00 JST
    const infoSpy = vi.mocked(console.info);

    await dispatch({
      channels: ["alexa-reminder"],
      notification: { kind: "reminder", title: "リマインダー", body: "買い物", severity: "mid" },
      respectQuietHours: true,
    });

    expect(infoSpy).toHaveBeenCalledWith(
      "[notification] quiet hours, skipping alexa-reminder",
    );
    vi.useRealTimers();
  });

  it("critical 通知は quiet hours でも alexa-reminder を配信する", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T14:00:00Z")); // 23:00 JST
    const infoSpy = vi.mocked(console.info);

    await dispatch({
      channels: ["alexa-reminder"],
      notification: { kind: "alert", title: "緊急", body: "異常検知", severity: "critical" },
      respectQuietHours: true,
    });

    expect(infoSpy).toHaveBeenCalledWith("[alexa-reminder stub]", "緊急", "異常検知");
    vi.useRealTimers();
  });

  it("複数チャンネル同時配信: pairpanel と alexa-reminder 両方実行する", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T01:00:00Z")); // 10:00 JST
    const infoSpy = vi.mocked(console.info);

    await dispatch({
      channels: ["pairpanel", "alexa-reminder"],
      notification: { kind: "task-result", title: "完了", body: "旅行候補が出ました", severity: "mid" },
      respectQuietHours: false,
    });

    expect(pairpanel.postNotification).toHaveBeenCalledOnce();
    expect(infoSpy).toHaveBeenCalledWith("[alexa-reminder stub]", "完了", "旅行候補が出ました");
    vi.useRealTimers();
  });
});
```

- [ ] **Step 3-3: テストが失敗することを確認する**

```bash
cd lambda && npx vitest run src/services/__tests__/notificationDispatcher.test.ts
```

Expected: `FAIL` — `notificationDispatcher` が存在しないエラー

- [ ] **Step 3-4: notificationDispatcher を実装する**

`lambda/src/services/notificationDispatcher.ts` を作成する:

```typescript
import { postNotification, type PairpanelNotification } from "./pairpanel";

export type NotificationPayload = PairpanelNotification;

export interface DispatchOptions {
  channels: Array<"pairpanel" | "alexa-reminder">;
  notification: NotificationPayload;
  respectQuietHours: boolean;
}

function isQuietHour(): boolean {
  const hour = parseInt(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Tokyo",
      hour: "numeric",
      hour12: false,
    }).format(new Date()),
    10,
  );
  return hour >= 22 || hour < 7;
}

export async function dispatch(opts: DispatchOptions): Promise<void> {
  const { channels, notification, respectQuietHours } = opts;
  const quiet = respectQuietHours && isQuietHour() && notification.severity !== "critical";

  await Promise.allSettled(
    channels.map(async (channel) => {
      if (channel === "pairpanel") {
        await postNotification(notification);
      } else if (channel === "alexa-reminder") {
        if (quiet) {
          console.info("[notification] quiet hours, skipping alexa-reminder");
          return;
        }
        // Plan B: Alexa Reminders API の実際の呼び出しに差し替える
        console.info("[alexa-reminder stub]", notification.title, notification.body);
      }
    }),
  );
}
```

- [ ] **Step 3-5: テストが通ることを確認する**

```bash
cd lambda && npx vitest run src/services/__tests__/notificationDispatcher.test.ts
```

Expected: `PASS` (5 tests)

- [ ] **Step 3-6: 全テストが通ることを確認する**

```bash
cd lambda && npx vitest run
```

Expected: 全テスト PASS

- [ ] **Step 3-7: コミット**

```bash
git add lambda/src/services/pairpanel.ts lambda/src/services/notificationDispatcher.ts lambda/src/services/__tests__/notificationDispatcher.test.ts
git commit -m "feat: add pairpanel postNotification and notification dispatcher"
```

---

## Task 4: openai.ts — システムプロンプト・agentTools 統合・ラウンド拡張・タイミング検出

**Files:**
- Modify: `lambda/src/services/openai.ts`

※ openai.ts の変更はロジックが複雑なため全体を差し替える形で示す。テストは手動動作確認。

- [ ] **Step 4-1: SYSTEM_INSTRUCTIONS を更新する**

`lambda/src/services/openai.ts` の `SYSTEM_INSTRUCTIONS` 定数を以下に差し替える:

```typescript
const SYSTEM_INSTRUCTIONS =
  "あなたはAlexaで動く日本語アシスタントです。" +
  "音声で聞きやすいよう、簡潔に答えてください。" +
  "箇条書きや記号は使わず、自然な話し言葉で回答してください。" +
  "利用者は石井健（1999年4月4日生まれ）か石井奈緒（1999年4月11日生まれ）の夫婦のいずれかです。" +
  "あなたの学習データは約2年前までのものであり古い。そのため、事実に関する質問・情報を求める質問には、確信がある場合を除いてresearch_webツールを積極的に使って最新情報を確認すること。" +
  "\n\n## ツールのリスク分類と確認ルール\n" +
  "midリスクのツールは実行前に必ず「○○しますがよろしいですか？」と確認し、肯定応答を得てから実行すること。\n" +
  "highリスクのツールは「申し訳ありません、この操作は現在対応しておりません」と答えて実行しないこと。\n" +
  "low（確認不要）: get_today_events, get_events_by_date, get_shopping_list, research_web, make_plan, defer_to_async\n" +
  "mid（実行前確認必須）: add_calendar_event, add_shopping_items, turn_on_device, turn_off_device, set_ac_temperature, set_ac_mode, complete_all_shopping\n" +
  "high（実行禁止）: send_slack_message\n\n" +
  "## プランニングルール\n" +
  "ユーザーの依頼が3ステップ以上必要と判断したとき、まずmake_planツールで計画を宣言してから実行すること。\n" +
  "推定25秒超の処理またはステップ数が6以上の場合はdefer_to_asyncで非同期に切り替えること。";
```

- [ ] **Step 4-2: import と定数を更新する**

ファイル先頭の import 群に以下を追加する:

```typescript
import { agentToolDefinitions, executeAgentTool } from "./tools/agentTools";
```

定数を以下に変更する:

```typescript
const DEFAULT_TIMEOUT_MS = 15000;
const MAX_TOOL_ROUNDS = 5;        // 既存: 3 → 5 に拡張
const PLANNING_ROUNDS = 8;         // make_plan 使用時の上限
const ASYNC_THRESHOLD_MS = 22000;  // 22 秒超で非同期推奨ログを出す
```

- [ ] **Step 4-3: CUSTOM_TOOLS に agentToolDefinitions を追加する**

```typescript
const CUSTOM_TOOLS = [
  ...shoppingToolDefinitions,
  ...calendarToolDefinitions,
  ...switchbotToolDefinitions,
  ...(process.env.SLACK_WEBHOOK_URL ? slackToolDefinitions : []),
  ...(process.env.GEMINI_API_KEY ? [researchToolDefinition] : []),
  ...agentToolDefinitions,   // ← 追加
];
```

- [ ] **Step 4-4: executeToolDispatch に agentContext を追加する**

`executeToolDispatch` の定義を変更する:

```typescript
async function executeToolDispatch(
  name: string,
  args: Record<string, unknown>,
  agentContext: { userId?: string },
): Promise<string> {
  if (name === "research_web") {
    const result = await research(args.query as string);
    return JSON.stringify({ result });
  }
  return (
    (await executeShoppingTool(name, args)) ??
    (await executeCalendarTool(name, args)) ??
    (await executeSwitchbotTool(name, args)) ??
    (await executeSlackTool(name, args)) ??
    (await executeAgentTool(name, args, agentContext)) ??  // ← 追加
    JSON.stringify({ error: `未知の関数: ${name}` })
  );
}
```

- [ ] **Step 4-5: chat() 関数シグネチャに userId を追加してループを拡張する**

`chat()` 関数全体を以下に差し替える（既存コードからの変更点はコメントで示す）:

```typescript
export async function chat(
  userQuery: string,
  previousResponseId?: string,
  contextData?: string,
  userId?: string,          // ← 追加
): Promise<ChatResult> {
  const tools: OpenAI.Responses.ResponseCreateParams["tools"] = [...CUSTOM_TOOLS];

  const nowJST = new Date().toLocaleString("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "long",
    hour: "2-digit",
    minute: "2-digit",
  });
  const baseInstructions = `${SYSTEM_INSTRUCTIONS}\n\n現在の日時（JST）: ${nowJST}`;
  const instructions = contextData
    ? `${baseInstructions}\n\n以下の情報を使って回答してください:\n${contextData}`
    : baseInstructions;

  let response = await openai.responses.create(
    {
      model: process.env.OPENAI_MODEL ?? "gpt-4.1-mini",
      instructions,
      input: userQuery,
      tools,
      ...(previousResponseId ? { previous_response_id: previousResponseId } : {}),
    },
    { timeout: DEFAULT_TIMEOUT_MS },
  );

  const startMs = Date.now();           // ← 追加: タイミング計測開始
  let planningMode = false;             // ← 追加: 計画モードフラグ
  const agentContext = { userId };      // ← 追加: ツール実行コンテキスト

  for (let round = 0; round < (planningMode ? PLANNING_ROUNDS : MAX_TOOL_ROUNDS); round++) {
    const functionCalls = response.output.filter(
      (item): item is OpenAI.Responses.ResponseFunctionToolCall =>
        item.type === "function_call"
    );

    if (functionCalls.length === 0) {
      return {
        text: cleanForSpeech(response.output_text),
        responseId: response.id,
      };
    }

    // make_plan が呼ばれたら planning モードに切り替える ← 追加
    if (functionCalls.some((c) => c.name === "make_plan")) planningMode = true;

    // 時間超過チェック ← 追加
    if (Date.now() - startMs > ASYNC_THRESHOLD_MS) {
      console.warn("[chat] async threshold exceeded at round", round);
      return {
        text:
          cleanForSpeech(response.output_text) ||
          "処理に時間がかかっています。もう少し時間をおいてから再度お試しください。",
        responseId: undefined,
      };
    }

    const toolOutputs: ResponseInputItem.FunctionCallOutput[] = await Promise.all(
      functionCalls.map(async (call) => {
        let output: string;
        try {
          output = await executeToolDispatch(
            call.name,
            JSON.parse(call.arguments) as Record<string, unknown>,
            agentContext,   // ← 追加
          );
        } catch (err) {
          output = JSON.stringify({ error: String(err) });
        }
        return { type: "function_call_output" as const, call_id: call.call_id, output };
      })
    );

    response = await openai.responses.create(
      {
        model: process.env.OPENAI_MODEL ?? "gpt-4.1-mini",
        instructions: SYSTEM_INSTRUCTIONS,
        input: toolOutputs,
        tools,
        previous_response_id: response.id,
      },
      { timeout: DEFAULT_TIMEOUT_MS },
    );
  }

  const pendingCalls = response.output.filter((item) => item.type === "function_call");
  return {
    text:
      cleanForSpeech(response.output_text) ||
      "処理に時間がかかりすぎました。もう一度お試しください。",
    responseId: pendingCalls.length === 0 ? response.id : undefined,
  };
}
```

- [ ] **Step 4-6: ビルドエラーがないことを確認する**

```bash
cd lambda && npx tsc --noEmit
```

Expected: エラーなし

- [ ] **Step 4-7: 全テストが通ることを確認する**

```bash
cd lambda && npx vitest run
```

Expected: 全テスト PASS

- [ ] **Step 4-8: コミット**

```bash
git add lambda/src/services/openai.ts
git commit -m "feat: extend agent loop with make_plan, risk classification, and timing guard"
```

---

## Task 5: ChatIntentHandler.ts — userId を chat() に渡す

**Files:**
- Modify: `lambda/src/handlers/ChatIntentHandler.ts`

- [ ] **Step 5-1: userId を取得して chat() 呼び出しに渡す**

`ChatIntentHandler.ts` の `handle()` メソッド内を以下のように変更する。

変更前（42 行目付近）:
```typescript
const sessionAttributes = handlerInput.attributesManager.getSessionAttributes();
const previousResponseId = sessionAttributes[SESSION_KEY_RESPONSE_ID] as string | undefined;
```

変更後（userId 取得を 1 行追加）:
```typescript
const userId = handlerInput.requestEnvelope.context.System.user.userId;
const sessionAttributes = handlerInput.attributesManager.getSessionAttributes();
const previousResponseId = sessionAttributes[SESSION_KEY_RESPONSE_ID] as string | undefined;
```

変更前（briefingMode 分岐の chat 呼び出し、60 行目付近）:
```typescript
const result = await chat(briefingQuery, previousResponseId, contextWithMemory);
```

変更後:
```typescript
const result = await chat(briefingQuery, previousResponseId, contextWithMemory, userId);
```

変更前（通常モードの chat 呼び出し、65 行目付近）:
```typescript
const result = await chat(query, previousResponseId, contextData);
```

変更後:
```typescript
const result = await chat(query, previousResponseId, contextData, userId);
```

- [ ] **Step 5-2: ビルドエラーがないことを確認する**

```bash
cd lambda && npx tsc --noEmit
```

Expected: エラーなし

- [ ] **Step 5-3: コミット**

```bash
git add lambda/src/handlers/ChatIntentHandler.ts
git commit -m "feat: pass userId to chat for async task context"
```

---

## Task 6: LaunchRequestHandler.ts — Reminders API 権限リクエスト

**Files:**
- Modify: `lambda/src/handlers/LaunchRequestHandler.ts`

- [ ] **Step 6-1: Reminders 権限チェックと権限リクエストカードを追加する**

`LaunchRequestHandler.ts` の `handle()` メソッドの return 文を以下に差し替える:

変更前:
```typescript
return handlerInput.responseBuilder
  .speak("はい、どうぞ。")
  .reprompt("何か聞きたいことはありますか？")
  .getResponse();
```

変更後:
```typescript
const user = handlerInput.requestEnvelope.context.System.user;
const hasRemindersPermission =
  (user.permissions as { scopes?: Record<string, { status?: string }> } | undefined)
    ?.scopes?.["alexa::alerts:reminders:skill:readwrite"]?.status === "GRANTED";

const speechText = hasRemindersPermission
  ? "はい、どうぞ。"
  : "はい、どうぞ。通知機能を有効にするには、Alexaアプリからリマインダーの権限を許可してください。";

const builder = handlerInput.responseBuilder
  .speak(speechText)
  .reprompt("何か聞きたいことはありますか？");

if (!hasRemindersPermission) {
  builder.withAskForPermissionsConsentCard(["alexa::alerts:reminders:skill:readwrite"]);
}

return builder.getResponse();
```

- [ ] **Step 6-2: ビルドエラーがないことを確認する**

```bash
cd lambda && npx tsc --noEmit
```

Expected: エラーなし

- [ ] **Step 6-3: コミット**

```bash
git add lambda/src/handlers/LaunchRequestHandler.ts
git commit -m "feat: request Reminders API permission on launch"
```

---

## Task 7: skill.json 権限追加・ビルド・stg デプロイ

**Files:**
- Modify: `skill-package/skill.json`

- [ ] **Step 7-1: skill.json に Reminders 権限を追加する**

`skill-package/skill.json` の `manifest` オブジェクト内に `permissions` キーを追加する（`privacyAndCompliance` の前に挿入）:

変更前:
```json
{
  "manifest": {
    "publishingInformation": { ... },
    "apis": { ... },
    "privacyAndCompliance": { ... },
    "manifestVersion": "1.0"
  }
}
```

変更後（`permissions` を追加）:
```json
{
  "manifest": {
    "publishingInformation": { ... },
    "apis": { ... },
    "permissions": [
      {
        "name": "alexa::alerts:reminders:skill:readwrite"
      }
    ],
    "privacyAndCompliance": { ... },
    "manifestVersion": "1.0"
  }
}
```

- [ ] **Step 7-2: 全テストを通す**

```bash
cd lambda && npx vitest run
```

Expected: 全テスト PASS

- [ ] **Step 7-3: ビルドする**

```bash
cd lambda && npm run build
```

Expected: `index.js` が生成されエラーなし

- [ ] **Step 7-4: stg にデプロイする**

```bash
cd /Users/ishiiken/Develop/alexa-chatgpt && ask deploy --profile stg --ignore-hash && aws lambda update-function-configuration --function-name ask-gpt-stg-default-1778390136821 --timeout 30 --region ap-northeast-1 --profile stg
```

Expected: デプロイ成功メッセージ

- [ ] **Step 7-5: 動作確認（Alexa シミュレータ または 実機）**

以下を順に発話してスモークテストする:

1. 「チャッピーを開いて」→ 起動メッセージ確認（Reminders 権限案内が出るか確認）
2. 「来週の土曜日って何か予定ある？」→ カレンダー取得（low リスク、確認なし）
3. 「カレンダーに明日の午後3時に歯医者を追加して」→ 「追加しますがよろしいですか？」の確認が入るか確認
4. 「Slackでおはようと送って」→ 「申し訳ありません、この操作は現在対応しておりません」と返るか確認
5. 複雑な依頼（例：「今週末の空き時間を調べて、天気も確認して旅行候補を2つ出して」）→ make_plan が CloudWatch ログに `[make_plan]` で出力されるか確認

- [ ] **Step 7-6: CloudWatch ログで agentTools の動作を確認する**

```bash
aws logs tail /aws/lambda/ask-gpt-stg-default-1778390136821 --follow --profile stg --region ap-northeast-1 | grep -E "\[make_plan\]|\[defer_to_async\]|\[async-task stub\]|\[alexa-reminder stub\]"
```

`make_plan` や `defer_to_async` の呼び出しログが出ていれば正常。

- [ ] **Step 7-7: コミット**

```bash
git add skill-package/skill.json
git commit -m "feat: add Reminders API permission to skill manifest"
```

---

## セルフレビュー

### Spec カバレッジ確認

| Spec 要件 | 対応タスク |
|---|---|
| make_plan ツール | Task 2 |
| defer_to_async ツール（stub） | Task 2 |
| asyncTaskClient stub | Task 1 |
| リスク分類システムプロンプト | Task 4 |
| mid-risk 実行前確認 | Task 4（プロンプト経由で LLM が判断） |
| high-risk（send_slack_message）実行禁止 | Task 4（プロンプト） |
| MAX_TOOL_ROUNDS 5 / PLANNING_ROUNDS 8 | Task 4 |
| タイミング検出（22 秒） | Task 4 |
| userId を chat() に渡す | Task 5 |
| notificationDispatcher | Task 3 |
| pairpanel postNotification | Task 3 |
| Alexa Reminders stub | Task 3 |
| Quiet hours（22:00〜7:00） | Task 3 |
| Reminders API 権限リクエスト | Task 6 |
| skill.json 権限追加 | Task 7 |

### 含まれないもの（Plan B / C へ）

- DynamoDB agent-tasks テーブルの実際の読み書き（Task 1 が stub）
- Step Functions の実際の StartExecution（Task 2 が stub）
- Alexa Reminders API の実際の呼び出し（Task 3 が stub）
- pairpanel `/api/v1/notifications` エンドポイント（Task 3 が graceful fail）
- EventBridge cron（朝のブリーフィング、雨予報）
- ユーザー ID チェックの声紋識別

---

## 実行オプション

**Plan A の実装は alexa-chatgpt リポジトリのみ。Plan B（AWS infra）と Plan C（pairpanel API + UI）は独立したプランとして後続で作成する。**

**Plan complete and saved to `docs/superpowers/plans/2026-05-11-super-agent-plan-a-lambda-smart.md`.**

Two execution options:

**1. Subagent-Driven（推奨）** — タスクごとに新しいサブエージェントを起動、タスク間でレビュー、高速イテレーション

**2. Inline Execution** — このセッションで executing-plans を使って実行、チェックポイントでレビュー

Which approach?
