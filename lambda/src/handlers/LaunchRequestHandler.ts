import {
  HandlerInput,
  RequestHandler,
} from "ask-sdk-core";
import { RequestEnvelope } from "ask-sdk-model";

export const LaunchRequestHandler: RequestHandler = {
  canHandle(handlerInput: HandlerInput): boolean {
    return (
      handlerInput.requestEnvelope.request.type === "LaunchRequest"
    );
  },
  handle(handlerInput: HandlerInput) {
    const speakOutput = "はい、どうぞ。";

    return handlerInput.responseBuilder
      .speak(speakOutput)
      .reprompt("何か聞きたいことはありますか？")
      .getResponse();
  },
};
