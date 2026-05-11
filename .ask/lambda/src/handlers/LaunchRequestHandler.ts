import { HandlerInput, RequestHandler } from "ask-sdk-core";
import { getMemory } from "../services/memory";

const SESSION_KEY_MEMORY = "memoryContext";

export const LaunchRequestHandler: RequestHandler = {
  canHandle(handlerInput: HandlerInput): boolean {
    return handlerInput.requestEnvelope.request.type === "LaunchRequest";
  },
  async handle(handlerInput: HandlerInput) {
    const userId = handlerInput.requestEnvelope.context.System.user.userId;
    const memory = await getMemory(userId);

    if (memory) {
      const sessionAttributes = handlerInput.attributesManager.getSessionAttributes();
      sessionAttributes[SESSION_KEY_MEMORY] = memory;
      handlerInput.attributesManager.setSessionAttributes(sessionAttributes);
    }

    return handlerInput.responseBuilder
      .speak("はい、どうぞ。")
      .reprompt("何か聞きたいことはありますか？")
      .getResponse();
  },
};
