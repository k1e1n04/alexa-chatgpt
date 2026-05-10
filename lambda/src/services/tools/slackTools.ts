import type OpenAI from "openai";

export const slackToolDefinitions: OpenAI.Responses.FunctionTool[] = [
  {
    type: "function",
    name: "send_slack_message",
    description: "Slack にメッセージを送る。家族への連絡や通知に使う",
    parameters: {
      type: "object",
      properties: {
        message: { type: "string", description: "送信するメッセージ本文" },
      },
      required: ["message"],
    },
  },
];

export async function executeSlackTool(
  name: string,
  args: Record<string, unknown>,
): Promise<string | null> {
  if (name !== "send_slack_message") return null;

  const webhookUrl = process.env.SLACK_WEBHOOK_URL;
  if (!webhookUrl) throw new Error("SLACK_WEBHOOK_URL is not set");

  const message = args.message as string;
  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: message }),
  });

  if (!res.ok) throw new Error(`Slack API error: ${res.status}`);
  return JSON.stringify({ message: "Slackにメッセージを送りました" });
}
