import { HandlerInput } from "ask-sdk-core";

export async function sendProgressiveResponse(handlerInput: HandlerInput, speech: string): Promise<boolean> {
  try {
    const directiveClient = handlerInput.serviceClientFactory!.getDirectiveServiceClient();
    await Promise.race([
      directiveClient.enqueue({
        header: { requestId: handlerInput.requestEnvelope.request.requestId },
        directive: { type: "VoicePlayer.Speak", speech },
      }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), 2000)),
    ]);
    console.info("[progressive-response] sent");
    return true;
  } catch (e) {
    console.warn("[progressive-response] failed:", e);
    return false;
  }
}
