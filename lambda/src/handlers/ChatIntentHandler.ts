import { HandlerInput, RequestHandler } from "ask-sdk-core";
import { IntentRequest } from "ask-sdk-model";
import { chat } from "../services/openai";
import { research } from "../services/gemini";

const RESEARCH_KEYWORDS_SUFFIX = ["調べて", "調べといて", "検索して", "探して", "リサーチして", "について", "とは何", "とは", "って何"];
const RESEARCH_KEYWORDS_CONTAINS = ["ってどんな", "ってどういう", "について教えて"];

function isResearchQuery(query: string): boolean {
  if (RESEARCH_KEYWORDS_SUFFIX.some((kw) => query.endsWith(kw))) return true;
  if (RESEARCH_KEYWORDS_CONTAINS.some((kw) => query.includes(kw))) return true;
  return false;
}

async function sendProgressiveResponse(handlerInput: HandlerInput, speech: string): Promise<boolean> {
  try {
    const directiveClient = handlerInput.serviceClientFactory!.getDirectiveServiceClient();
    await Promise.race([
      directiveClient.enqueue({
        header: { requestId: handlerInput.requestEnvelope.request.requestId },
        directive: { type: "VoicePlayer.Speak", speech },
      }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), 1000)),
    ]);
    return true;
  } catch (e) {
    console.warn("[progressive-response] failed:", e);
    return false;
  }
}

const SESSION_KEY_RESPONSE_ID = "previousResponseId";

export const ChatIntentHandler: RequestHandler = {
  canHandle(handlerInput: HandlerInput): boolean {
    return (
      handlerInput.requestEnvelope.request.type === "IntentRequest" &&
      (handlerInput.requestEnvelope.request as IntentRequest).intent.name ===
        "ChatIntent"
    );
  },
  async handle(handlerInput: HandlerInput) {
    const request = handlerInput.requestEnvelope.request as IntentRequest;
    const rawQuery = request.intent.slots?.query?.value ?? "";
    const topicQuery = request.intent.slots?.topic?.value ?? "";
    const shopItem = request.intent.slots?.shopItem?.value ?? "";
    const shopAction = request.intent.slots?.shopAction?.value ?? "";

    let query: string;
    let researchMode: boolean;

    if (shopItem) {
      query = `${shopItem}を買い物リストに追加して`;
      researchMode = false;
    } else if (shopAction) {
      query = `買い物リストを${shopAction}`;
      researchMode = false;
    } else if (topicQuery) {
      query = topicQuery;
      researchMode = true;
    } else {
      query = rawQuery;
      researchMode = isResearchQuery(rawQuery);
    }

    const LAUNCH_PHRASES = ["を開いて", "開いて", "を起動して", "起動して"];
    if (!query || LAUNCH_PHRASES.includes(query.trim())) {
      return handlerInput.responseBuilder
        .speak("はい、どうぞ。")
        .reprompt("何か聞きたいことはありますか？")
        .getResponse();
    }

    const sessionAttributes =
      handlerInput.attributesManager.getSessionAttributes();
    const previousResponseId = sessionAttributes[SESSION_KEY_RESPONSE_ID] as
      | string
      | undefined;

    try {
      if (researchMode) {
        await sendProgressiveResponse(handlerInput, "少々お待ちください。");
      }

      let responseText: string;
      let responseId: string | undefined;

      if (researchMode && process.env.GEMINI_API_KEY) {
        responseText = await research(query);
      } else {
        const result = await chat(query, previousResponseId);
        responseText = result.text;
        responseId = result.responseId;
      }

      if (responseId) {
        sessionAttributes[SESSION_KEY_RESPONSE_ID] = responseId;
        handlerInput.attributesManager.setSessionAttributes(sessionAttributes);
      }

      return handlerInput.responseBuilder
        .speak(responseText)
        .reprompt("他に何か聞きたいことはありますか？")
        .getResponse();
    } catch (error) {
      console.error("OpenAI API error:", error);
      const isTimeout =
        error instanceof Error &&
        (error.message.includes("timeout") || error.message.includes("timed out"));
      const message = isTimeout
        ? "少し時間がかかっています。もう一度同じ質問をしてみてください。"
        : "エラーが発生しました。もう一度試してみてください。";
      return handlerInput.responseBuilder
        .speak(message)
        .reprompt("何か聞きたいことはありますか？")
        .getResponse();
    }
  },
};
