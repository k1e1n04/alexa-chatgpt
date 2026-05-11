import type OpenAI from "openai";
import { postNotification } from "../pairpanel";

export const pairpanelToolDefinitions: OpenAI.Responses.FunctionTool[] = [
  {
    type: "function",
    name: "send_pairpanel_notification",
    description: "pairpanel（家族アプリ）に通知を送る。調査結果の共有や作業完了の報告など、後で確認できる形で伝えたいときに使う",
    strict: false,
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "通知タイトル（短く端的に）" },
        body: { type: "string", description: "通知本文" },
        kind: {
          type: "string",
          enum: ["reminder", "task-result", "alert"],
          description: "通知の種別。デフォルトは reminder",
        },
        severity: {
          type: "string",
          enum: ["low", "mid", "high"],
          description: "重要度。デフォルトは low",
        },
      },
      required: ["title", "body"],
    },
  },
];

export async function executePairpanelTool(
  name: string,
  args: Record<string, unknown>,
): Promise<string | null> {
  if (name !== "send_pairpanel_notification") return null;

  await postNotification({
    kind: (args.kind as "reminder" | "task-result" | "alert") ?? "reminder",
    title: args.title as string,
    body: args.body as string,
    severity: (args.severity as "low" | "mid" | "high" | "critical") ?? "low",
  });

  return JSON.stringify({ message: "pairpanelに通知を送りました" });
}
