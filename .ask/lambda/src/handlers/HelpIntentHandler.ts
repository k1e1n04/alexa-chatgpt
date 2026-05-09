import { HandlerInput, RequestHandler } from "ask-sdk-core";
import { IntentRequest } from "ask-sdk-model";

export const HelpIntentHandler: RequestHandler = {
  canHandle(handlerInput: HandlerInput): boolean {
    return (
      handlerInput.requestEnvelope.request.type === "IntentRequest" &&
      (handlerInput.requestEnvelope.request as IntentRequest).intent.name ===
        "AMAZON.HelpIntent"
    );
  },
  handle(handlerInput: HandlerInput) {
    const speakOutput =
      "GPTアシスタントです。質問を話しかけるだけで答えます。" +
      "たとえば「東京の人口は？」や「今日のニュースを教えて」のように話しかけてみてください。" +
      "ウェブを検索して最新情報も調べられます。";

    return handlerInput.responseBuilder
      .speak(speakOutput)
      .reprompt("何でも聞いてください。")
      .getResponse();
  },
};
