import { HandlerInput, RequestHandler } from "ask-sdk-core";
import { IntentRequest } from "ask-sdk-model";
import { chat } from "../services/openai";
import { research } from "../services/gemini";
import { buildQuery } from "../chat/queryBuilder";
import { sendProgressiveResponse } from "../chat/progressiveResponse";

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
    const { query, researchMode, isLaunchPhrase } = buildQuery({
      rawQuery: request.intent.slots?.query?.value ?? "",
      topicQuery: request.intent.slots?.topic?.value ?? "",
      shopItem: request.intent.slots?.shopItem?.value ?? "",
      shopAction: request.intent.slots?.shopAction?.value ?? "",
    });

    if (isLaunchPhrase) {
      return handlerInput.responseBuilder
        .speak("はい、どうぞ。")
        .reprompt("何か聞きたいことはありますか？")
        .getResponse();
    }

    const sessionAttributes = handlerInput.attributesManager.getSessionAttributes();
    const previousResponseId = sessionAttributes[SESSION_KEY_RESPONSE_ID] as string | undefined;

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
