import { HandlerInput, RequestHandler } from "ask-sdk-core";
import { IntentRequest } from "ask-sdk-model";

export const FallbackIntentHandler: RequestHandler = {
  canHandle(handlerInput: HandlerInput): boolean {
    return (
      handlerInput.requestEnvelope.request.type === "IntentRequest" &&
      (handlerInput.requestEnvelope.request as IntentRequest).intent.name ===
        "AMAZON.FallbackIntent"
    );
  },
  handle(handlerInput: HandlerInput) {
    return handlerInput.responseBuilder
      .speak(
        "すみません、うまく聞き取れませんでした。" +
          "「ねえ」や「きいて」の後に質問してみてください。"
      )
      .reprompt("何でも聞いてください。")
      .getResponse();
  },
};
