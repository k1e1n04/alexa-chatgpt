import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";

const TABLE_NAME = process.env.MEMORY_TABLE_NAME ?? "alexa-chatgpt-memory";
const REGION = process.env.AWS_REGION ?? "ap-northeast-1";

const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));

export interface ConversationTurn {
  user: string;
  assistant: string;
}

export async function getMemory(userId: string): Promise<string | null> {
  try {
    const result = await dynamo.send(
      new GetCommand({ TableName: TABLE_NAME, Key: { userId } }),
    );
    return (result.Item?.summary as string) ?? null;
  } catch (err) {
    console.error("memory.get error:", err);
    return null;
  }
}

export async function saveMemory(
  userId: string,
  log: ConversationTurn[],
  existingSummary?: string,
): Promise<void> {
  if (log.length === 0) return;
  try {
    const summary = await summarizeLog(log, existingSummary);
    await dynamo.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: { userId, summary, updatedAt: new Date().toISOString() },
      }),
    );
  } catch (err) {
    console.error("memory.save error:", err);
  }
}

async function summarizeLog(log: ConversationTurn[], existingSummary?: string): Promise<string> {
  const OpenAI = (await import("openai")).default;
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 5000, maxRetries: 0 });

  const conversation = log
    .map((t) => `ユーザー: ${t.user}\nアシスタント: ${t.assistant}`)
    .join("\n");

  const input = existingSummary
    ? `既存の記憶:\n${existingSummary}\n\n今日の会話:\n${conversation}`
    : conversation;

  const instructions = existingSummary
    ? "既存の記憶に今日の会話を統合して1000文字以内の日本語に更新してください。重要な情報（名前、好み、決定事項、継続中の話題）を優先して残し、古い情報は適宜圧縮してください。"
    : "次の会話を1000文字以内の日本語で要約してください。次回の会話で文脈として使うので、重要な情報（名前、好み、決定事項、継続中の話題）を優先して含めてください。";

  const response = await openai.responses.create({
    model: process.env.OPENAI_MODEL ?? "gpt-4.1-mini",
    instructions,
    input,
  });

  return response.output_text.slice(0, 1000);
}
