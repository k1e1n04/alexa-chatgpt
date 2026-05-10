import { GoogleGenAI } from "@google/genai";

const SYSTEM_INSTRUCTIONS =
  "あなたはAlexaで動く日本語アシスタントです。" +
  "音声で聞きやすいよう、簡潔に答えてください。" +
  "箇条書きや記号は使わず、自然な話し言葉で回答してください。";

const RESEARCH_TIMEOUT_MS = 15000;

function cleanForSpeech(text: string): string {
  return text
    .replace(/\[([^\]]+)\]\(https?:\/\/[^\)]+\)/g, "$1")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/\[\d+\]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error("timed out")), ms)
    ),
  ]);
}

export async function research(query: string): Promise<string> {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY ?? "" });

  const responsePromise = ai.models.generateContent({
    model: process.env.GEMINI_MODEL ?? "gemini-flash-latest",
    contents: query,
    config: {
      tools: [{ googleSearch: {} }],
      systemInstruction: SYSTEM_INSTRUCTIONS,
    },
  });

  const response = await withTimeout(responsePromise, RESEARCH_TIMEOUT_MS);
  const text = response.text ?? "";
  console.log(`[gemini-research] text=${text.slice(0, 200)}`);
  return cleanForSpeech(text);
}
