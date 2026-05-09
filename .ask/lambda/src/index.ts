import { SkillBuilders } from "ask-sdk-core";
import { LaunchRequestHandler } from "./handlers/LaunchRequestHandler";
import { ChatIntentHandler } from "./handlers/ChatIntentHandler";
import { HelpIntentHandler } from "./handlers/HelpIntentHandler";
import { FallbackIntentHandler } from "./handlers/FallbackIntentHandler";
import { CancelAndStopHandler, SessionEndedHandler } from "./handlers/CancelAndStopHandler";

export const handler = SkillBuilders.custom()
  .addRequestHandlers(
    LaunchRequestHandler,
    ChatIntentHandler,
    HelpIntentHandler,
    FallbackIntentHandler,
    CancelAndStopHandler,
    SessionEndedHandler
  )
  .lambda();
