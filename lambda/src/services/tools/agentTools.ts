import type OpenAI from "openai";
import { createAsyncTask } from "../asyncTaskClient";

export const agentToolDefinitions: OpenAI.Responses.FunctionTool[] = [
  {
    type: "function",
    name: "make_plan",
    description:
      "ユーザーの依頼が3ステップ以上必要だと判断したときに呼び出す。実行計画を宣言する。" +
      "計画を宣言した後はステップを順番に実行すること。",
    strict: false,
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
      "処理が15秒以上かかる見込み、ステップが4個以上、または異なる種類のツールを2つ以上組み合わせるときに呼び出す。" +
      "処理を非同期に切り替え、完了後にpairpanelとAlexaで通知する。",
    strict: false,
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
      const delivery = args.delivery as string | undefined;
      const { taskId } = await createAsyncTask(context.userId ?? "unknown", goal, plan, delivery);
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
