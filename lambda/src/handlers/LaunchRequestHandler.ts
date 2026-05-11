import { HandlerInput, RequestHandler } from "ask-sdk-core";
import { getMemory } from "../services/memory";
import { getPendingCompletedTasks, markTaskNotified } from "../services/asyncTaskClient";

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

    let pendingTasks: Awaited<ReturnType<typeof getPendingCompletedTasks>> = [];
    try {
      pendingTasks = await getPendingCompletedTasks(userId);
    } catch (err) {
      console.warn("[launch] getPendingCompletedTasks failed", err);
    }

    const hasRemindersPermission =
      (user.permissions as { scopes?: Record<string, { status?: string }> } | undefined)
        ?.scopes?.["alexa::alerts:reminders:skill:readwrite"]?.status === "GRANTED";

    let speechText: string;
    if (pendingTasks.length > 0) {
      const taskList = pendingTasks.map((t) => `「${t.goal.slice(0, 20)}」`).join("、");
      speechText = `はい、どうぞ。さっきお願いした${taskList}の件が完了しています。確認しますか？`;
      void Promise.allSettled(pendingTasks.map((t) => markTaskNotified(t.taskId))).catch(() => {});
    } else if (!hasRemindersPermission) {
      speechText =
        "はい、どうぞ。通知機能を有効にするには、Alexaアプリからリマインダーの権限を許可してください。";
    } else {
      speechText = "はい、どうぞ。";
    }

    const builder = handlerInput.responseBuilder
      .speak(speechText)
      .reprompt("何か聞きたいことはありますか？");

    if (!hasRemindersPermission) {
      builder.withAskForPermissionsConsentCard(["alexa::alerts:reminders:skill:readwrite"]);
    }

    return builder.getResponse();
  },
};
