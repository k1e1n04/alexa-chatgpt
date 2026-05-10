import { HandlerInput, RequestHandler } from "ask-sdk-core";
import { IntentRequest } from "ask-sdk-model";
import { chat } from "../services/openai";

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
    const query =
      request.intent.slots?.query?.value ?? "";

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
      const result = await chat(query, previousResponseId);

      sessionAttributes[SESSION_KEY_RESPONSE_ID] = result.responseId;
      handlerInput.attributesManager.setSessionAttributes(sessionAttributes);

      return handlerInput.responseBuilder
        .speak(result.text)
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
