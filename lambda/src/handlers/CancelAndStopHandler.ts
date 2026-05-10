import { HandlerInput, RequestHandler } from "ask-sdk-core";
import { IntentRequest } from "ask-sdk-model";
import { saveMemory, ConversationTurn } from "../services/memory";

const SESSION_KEY_LOG = "conversationLog";

export const CancelAndStopHandler: RequestHandler = {
  canHandle(handlerInput: HandlerInput): boolean {
    const requestType = handlerInput.requestEnvelope.request.type;
    if (requestType !== "IntentRequest") return false;
    const intentName = (handlerInput.requestEnvelope.request as IntentRequest).intent.name;
    return intentName === "AMAZON.CancelIntent" || intentName === "AMAZON.StopIntent";
  },
  async handle(handlerInput: HandlerInput) {
    const userId = handlerInput.requestEnvelope.context.System.user.userId;
    const sessionAttributes = handlerInput.attributesManager.getSessionAttributes();
    const log = (sessionAttributes[SESSION_KEY_LOG] as ConversationTurn[]) ?? [];

    await saveMemory(userId, log);

    return handlerInput.responseBuilder
      .speak("またね！")
      .withShouldEndSession(true)
      .getResponse();
  },
};

export const SessionEndedHandler: RequestHandler = {
  canHandle(handlerInput: HandlerInput): boolean {
    return handlerInput.requestEnvelope.request.type === "SessionEndedRequest";
  },
  handle(handlerInput: HandlerInput) {
    return handlerInput.responseBuilder.getResponse();
  },
};
