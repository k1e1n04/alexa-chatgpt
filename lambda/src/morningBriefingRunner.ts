import { buildBriefingContext, getBriefingData } from "./services/briefing";
import { dispatch } from "./services/notificationDispatcher";
import { chat } from "./services/openai";

export const handler = async (): Promise<void> => {
  console.info("[morning-briefing] start");

  let briefingData;
  try {
    briefingData = await getBriefingData();
  } catch (err) {
    console.error("[morning-briefing] getBriefingData failed", err);
    return;
  }

  const contextData = buildBriefingContext(briefingData);

  let result;
  try {
    result = await chat(
      "今日のブリーフィングをお願いします。天気と予定を読み上げ、今日の気温に合わせた服装アドバイスも教えてください。",
      undefined,
      contextData,
      "morning-cron",
    );
  } catch (err) {
    console.error("[morning-briefing] chat failed", err);
    return;
  }

  const tomorrow = new Date(Date.now() + 20 * 60 * 60 * 1000).toISOString();
  await dispatch({
    channels: ["pairpanel"],
    notification: {
      kind: "briefing",
      title: "朝のブリーフィング",
      body: result.text,
      severity: "low",
      expiresAt: tomorrow,
    },
    respectQuietHours: false,
  });

  const desc = briefingData.weather?.description ?? "";
  if (desc.includes("雨") && !desc.includes("快晴") && !desc.includes("晴")) {
    await dispatch({
      channels: ["pairpanel"],
      notification: {
        kind: "reminder",
        title: "☂ 雨予報",
        body: `今日は${desc}。お出かけの際は傘をお忘れなく。`,
        severity: "mid",
        expiresAt: tomorrow,
      },
      respectQuietHours: false,
    });
  }

  console.info("[morning-briefing] done");
};
