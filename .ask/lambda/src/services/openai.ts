import OpenAI from "openai";
import type { ResponseInputItem } from "openai/resources/responses/responses";
import { shoppingToolDefinitions, executeShoppingTool } from "./tools/shoppingTools";
import { calendarToolDefinitions, executeCalendarTool } from "./tools/calendarTools";
import { switchbotToolDefinitions, executeSwitchbotTool } from "./tools/switchbotTools";
import { slackToolDefinitions, executeSlackTool } from "./tools/slackTools";
import { cleanForSpeech } from "./utils/speechUtils";
import { research } from "./gemini";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  timeout: 15000,
  maxRetries: 0,
});

const SYSTEM_INSTRUCTIONS =
  "あなたはAlexaで動く日本語アシスタントです。" +
  "音声で聞きやすいよう、簡潔に答えてください。" +
  "箇条書きや記号は使わず、自然な話し言葉で回答してください。" +
  "利用者は石井健（1999年4月4日生まれ）か石井奈緒（1999年4月11日生まれ）の夫婦のいずれかです。" +
  "あなたの学習データは約2年前までのものであり古い。そのため、事実に関する質問・情報を求める質問には、確信がある場合を除いてresearch_webツールを積極的に使って最新情報を確認すること。";

export interface ChatResult {
  text: string;
  responseId?: string;
}

const researchToolDefinition: OpenAI.Responses.FunctionTool = {
  type: "function",
  name: "research_web",
  description:
    "最新情報・ニュース・時事・天気・一般知識など、ウェブ検索が必要な質問に答えるときに使う。" +
    "カレンダー操作・買い物リスト・デバイス操作など他のツールで対応できる場合は使わない。",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "検索クエリ（日本語）" },
    },
    required: ["query"],
  },
};

const CUSTOM_TOOLS = [
  ...shoppingToolDefinitions,
  ...calendarToolDefinitions,
  ...switchbotToolDefinitions,
  ...(process.env.SLACK_WEBHOOK_URL ? slackToolDefinitions : []),
  ...(process.env.GEMINI_API_KEY ? [researchToolDefinition] : []),
];

async function executeToolDispatch(name: string, args: Record<string, unknown>): Promise<string> {
  if (name === "research_web") {
    const result = await research(args.query as string);
    return JSON.stringify({ result });
  }
  return (
    (await executeShoppingTool(name, args)) ??
    (await executeCalendarTool(name, args)) ??
    (await executeSwitchbotTool(name, args)) ??
    (await executeSlackTool(name, args)) ??
    JSON.stringify({ error: `未知の関数: ${name}` })
  );
}

const DEFAULT_TIMEOUT_MS = 15000;
const MAX_TOOL_ROUNDS = 3;

export async function chat(
  userQuery: string,
  previousResponseId?: string,
  contextData?: string,
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

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
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

    const toolOutputs: ResponseInputItem.FunctionCallOutput[] = await Promise.all(
      functionCalls.map(async (call) => {
        let output: string;
        try {
          output = await executeToolDispatch(call.name, JSON.parse(call.arguments) as Record<string, unknown>);
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

  // MAX_TOOL_ROUNDS を超えた場合、まだ function_call が残っていれば responseId を保存しない
  const pendingCalls = response.output.filter((item) => item.type === "function_call");
  return {
    text: cleanForSpeech(response.output_text) || "処理に時間がかかりすぎました。もう一度お試しください。",
    responseId: pendingCalls.length === 0 ? response.id : undefined,
  };
}
