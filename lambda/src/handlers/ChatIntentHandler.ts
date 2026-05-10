import { HandlerInput, RequestHandler } from "ask-sdk-core";
import { IntentRequest } from "ask-sdk-model";
import { chat } from "../services/openai";
import { research } from "../services/gemini";
import { buildQuery } from "../chat/queryBuilder";
import { sendProgressiveResponse } from "../chat/progressiveResponse";
import { getBriefingData, buildBriefingContext } from "../services/briefing";
import type { ConversationTurn } from "../services/memory";

const SESSION_KEY_RESPONSE_ID = "previousResponseId";
const SESSION_KEY_MEMORY = "memoryContext";
const SESSION_KEY_LOG = "conversationLog";

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
    const { query, researchMode, briefingMode, isLaunchPhrase } = buildQuery({
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
    const memoryContext = sessionAttributes[SESSION_KEY_MEMORY] as string | undefined;
    const conversationLog = (sessionAttributes[SESSION_KEY_LOG] as ConversationTurn[]) ?? [];

    try {
      if (briefingMode || researchMode) {
        await sendProgressiveResponse(handlerInput, "少々お待ちください。");
      }

      let responseText: string;
      let responseId: string | undefined;
      let loggedQuery = query;

      if (briefingMode) {
        const briefingData = await getBriefingData();
        const contextData = buildBriefingContext(briefingData);
        loggedQuery = "今日のブリーフィング";
        const briefingQuery = "今日のブリーフィングをお願いします。天気と予定を読み上げ、今日の気温に合わせた服装アドバイスも教えてください。";
        const contextWithMemory = memoryContext
          ? `${contextData}\n\n前回の会話コンテキスト: ${memoryContext}`
          : contextData;
        const result = await chat(briefingQuery, previousResponseId, contextWithMemory);
        responseText = result.text;
        responseId = result.responseId;
      } else if (researchMode && process.env.GEMINI_API_KEY) {
        responseText = await research(query);
      } else {
        const contextData = memoryContext ? `前回の会話コンテキスト: ${memoryContext}` : undefined;
        const result = await chat(query, previousResponseId, contextData);
        responseText = result.text;
        responseId = result.responseId;
      }

      conversationLog.push({ user: loggedQuery, assistant: responseText });
      sessionAttributes[SESSION_KEY_LOG] = conversationLog;

      if (responseId) {
        sessionAttributes[SESSION_KEY_RESPONSE_ID] = responseId;
      }
      handlerInput.attributesManager.setSessionAttributes(sessionAttributes);

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
