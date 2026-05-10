import OpenAI from "openai";
import type { ResponseInputItem } from "openai/resources/responses/responses";
import { shoppingToolDefinitions, executeShoppingTool } from "./tools/shoppingTools";
import { calendarToolDefinitions, executeCalendarTool } from "./tools/calendarTools";
import { cleanForSpeech } from "./utils/speechUtils";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  timeout: 3500,
  maxRetries: 0,
});

const SYSTEM_INSTRUCTIONS =
  "あなたはAlexaで動く日本語アシスタントです。" +
  "音声で聞きやすいよう、簡潔に答えてください。" +
  "箇条書きや記号は使わず、自然な話し言葉で回答してください。";

export interface ChatResult {
  text: string;
  responseId: string;
}

const CUSTOM_TOOLS = [...shoppingToolDefinitions, ...calendarToolDefinitions];

async function executeToolDispatch(name: string, args: Record<string, unknown>): Promise<string> {
  return (
    (await executeShoppingTool(name, args)) ??
    (await executeCalendarTool(name, args)) ??
    JSON.stringify({ error: `未知の関数: ${name}` })
  );
}

const DEFAULT_TIMEOUT_MS = 3500;

export async function chat(
  userQuery: string,
  previousResponseId?: string,
  contextData?: string,
): Promise<ChatResult> {
  const enableWebSearch = process.env.ENABLE_WEB_SEARCH === "true";

  const tools: OpenAI.Responses.ResponseCreateParams["tools"] = [
    ...CUSTOM_TOOLS,
    ...(enableWebSearch
      ? [{ type: "web_search" as const, search_context_size: "medium" as const }]
      : []),
  ];

  const instructions = contextData
    ? `${SYSTEM_INSTRUCTIONS}\n\n以下の情報を使って回答してください:\n${contextData}`
    : SYSTEM_INSTRUCTIONS;

  const firstResponse = await openai.responses.create(
    {
      model: process.env.OPENAI_MODEL ?? "gpt-4.1-mini",
      instructions,
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
        output = await executeToolDispatch(call.name, JSON.parse(call.arguments) as Record<string, unknown>);
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
