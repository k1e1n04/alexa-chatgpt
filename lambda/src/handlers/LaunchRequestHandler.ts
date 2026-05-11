import { HandlerInput, RequestHandler } from "ask-sdk-core";
import { getMemory } from "../services/memory";

const SESSION_KEY_MEMORY = "memoryContext";

export const LaunchRequestHandler: RequestHandler = {
  canHandle(handlerInput: HandlerInput): boolean {
    return handlerInput.requestEnvelope.request.type === "LaunchRequest";
  },
  async handle(handlerInput: HandlerInput) {
    const userId = handlerInput.requestEnvelope.context.System.user.userId;
    const user = handlerInput.requestEnvelope.context.System.user;
    const memory = await getMemory(userId);

    if (memory) {
      const sessionAttributes = handlerInput.attributesManager.getSessionAttributes();
      sessionAttributes[SESSION_KEY_MEMORY] = memory;
      handlerInput.attributesManager.setSessionAttributes(sessionAttributes);
    }

    const hasRemindersPermission =
      (user.permissions as { scopes?: Record<string, { status?: string }> } | undefined)
        ?.scopes?.["alexa::alerts:reminders:skill:readwrite"]?.status === "GRANTED";

    const speechText = hasRemindersPermission
      ? "はい、どうぞ。"
      : "はい、どうぞ。通知機能を有効にするには、Alexaアプリからリマインダーの権限を許可してください。";

    const builder = handlerInput.responseBuilder
      .speak(speechText)
      .reprompt("何か聞きたいことはありますか？");

    if (!hasRemindersPermission) {
      builder.withAskForPermissionsConsentCard(["alexa::alerts:reminders:skill:readwrite"]);
    }

    return builder.getResponse();
  },
};
