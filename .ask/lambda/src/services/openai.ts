import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  timeout: 7000,
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

export async function chat(
  userQuery: string,
  previousResponseId?: string
): Promise<ChatResult> {
  const enableWebSearch = process.env.ENABLE_WEB_SEARCH === "true";

  const response = await openai.responses.create({
    model: process.env.OPENAI_MODEL ?? "gpt-4.1-mini",
    instructions: SYSTEM_INSTRUCTIONS,
    input: userQuery,
    ...(enableWebSearch
      ? {
          tools: [{ type: "web_search" as const, search_context_size: "low" as const }],
        }
      : {}),
    ...(previousResponseId ? { previous_response_id: previousResponseId } : {}),
  });

  return {
    text: cleanForSpeech(response.output_text),
    responseId: response.id,
  };
}
