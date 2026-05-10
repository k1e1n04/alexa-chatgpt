import OpenAI from "openai";
import type { ResponseInputItem } from "openai/resources/responses/responses";
import { executeTool } from "./toolExecutor";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  timeout: 3500,
  maxRetries: 0,
});

const SYSTEM_INSTRUCTIONS =
  "あなたはAlexaで動く日本語アシスタントです。" +
  "音声で聞きやすいよう、簡潔に答えてください。" +
  "箇条書きや記号は使わず、自然な話し言葉で回答してください。";


function cleanForSpeech(text: string): string {
  return text
    .replace(/\[([^\]]+)\]\(https?:\/\/[^\)]+\)/g, "$1") // [テキスト](URL) → テキストだけ残す
    .replace(/https?:\/\/\S+/g, "")                       // 残った生URL を除去
    .replace(/\[\d+\]/g, "")                               // 脚注 [1] [2] を除去
    .replace(/\s+/g, " ")                                  // 連続スペースを整理
    .trim();
}

export interface ChatResult {
  text: string;
  responseId: string;
}

const CUSTOM_TOOLS: OpenAI.Responses.FunctionTool[] = [
  {
    type: "function",
    name: "get_shopping_list",
    description: "pairpanel のお買い物リストを取得する",
    parameters: { type: "object", properties: {}, required: [] },
  },
  {
    type: "function",
    name: "add_shopping_item",
    description: "pairpanel のお買い物リストに商品を1件追加する",
    parameters: {
      type: "object",
      properties: { name: { type: "string", description: "追加する商品名" } },
      required: ["name"],
    },
  },
  {
    type: "function",
    name: "complete_all_shopping",
    description: "指定した ID のお買い物を一括完了する。事前に get_shopping_list で ID を取得すること",
    parameters: {
      type: "object",
      properties: {
        ids: { type: "array", items: { type: "string" }, description: "完了するお買い物の ID リスト" },
      },
      required: ["ids"],
    },
  },
  {
    type: "function",
    name: "get_today_events",
    description: "今日の Google カレンダーの予定一覧を取得する",
    parameters: { type: "object", properties: {}, required: [] },
  },
  {
    type: "function",
    name: "add_calendar_event",
    description: "Google カレンダーに予定を追加する",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "予定のタイトル" },
        start_time: { type: "string", description: "開始日時 (ISO 8601 JST例: 2026-05-10T15:00:00+09:00)" },
        end_time: { type: "string", description: "終了日時 (ISO 8601 JST例: 2026-05-10T16:00:00+09:00)" },
      },
      required: ["title", "start_time", "end_time"],
    },
  },
];

const DEFAULT_TIMEOUT_MS = 3500;

export async function chat(
  userQuery: string,
  previousResponseId?: string,
): Promise<ChatResult> {
  const enableWebSearch = process.env.ENABLE_WEB_SEARCH === "true";

  const tools: OpenAI.Responses.ResponseCreateParams["tools"] = [
    ...CUSTOM_TOOLS,
    ...(enableWebSearch
      ? [{ type: "web_search" as const, search_context_size: "medium" as const }]
      : []),
  ];

  const firstResponse = await openai.responses.create(
    {
      model: process.env.OPENAI_MODEL ?? "gpt-4.1-mini",
      instructions: SYSTEM_INSTRUCTIONS,
      input: userQuery,
      tools,
      ...(previousResponseId ? { previous_response_id: previousResponseId } : {}),
    },
    { timeout: DEFAULT_TIMEOUT_MS },
  );

  const functionCalls = firstResponse.output.filter(
    (item): item is OpenAI.Responses.ResponseFunctionToolCall =>
      item.type === "function_call"
  );

  if (functionCalls.length === 0) {
    return {
      text: cleanForSpeech(firstResponse.output_text),
      responseId: firstResponse.id,
    };
  }

  const toolOutputs: ResponseInputItem.FunctionCallOutput[] = await Promise.all(
    functionCalls.map(async (call) => {
      let output: string;
      try {
        output = await executeTool(call.name, JSON.parse(call.arguments) as Record<string, unknown>);
      } catch (err) {
        output = JSON.stringify({ error: String(err) });
      }
      return { type: "function_call_output" as const, call_id: call.call_id, output };
    })
  );

  const secondResponse = await openai.responses.create(
    {
      model: process.env.OPENAI_MODEL ?? "gpt-4.1-mini",
      instructions: SYSTEM_INSTRUCTIONS,
      input: toolOutputs,
      tools,
      previous_response_id: firstResponse.id,
    },
    { timeout: DEFAULT_TIMEOUT_MS },
  );

  return {
    text: cleanForSpeech(secondResponse.output_text),
    responseId: secondResponse.id,
  };
}
