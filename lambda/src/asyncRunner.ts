import { updateTaskStatus } from "./services/asyncTaskClient";
import { dispatch } from "./services/notificationDispatcher";
import { chat } from "./services/openai";

interface AsyncRunnerEvent {
  taskId: string;
  userId: string;
  goal: string;
  plan: string[];
  delivery?: string;
  forceFail?: boolean;
  error?: unknown;
}

function deliveryToChannels(delivery?: string): Array<"pairpanel" | "alexa-reminder"> {
  if (delivery === "alexa-reminder") return ["alexa-reminder"];
  if (delivery === "both") return ["pairpanel", "alexa-reminder"];
  return ["pairpanel"];
}

export const handler = async (event: AsyncRunnerEvent): Promise<void> => {
  const { taskId, userId, goal, delivery, forceFail } = event;
  const channels = deliveryToChannels(delivery);

  if (forceFail) {
    const errMsg = String(event.error ?? "Step Functions execution failed");
    await updateTaskStatus(taskId, "failed", undefined, errMsg);
    await dispatch({
      channels,
      notification: {
        kind: "alert",
        title: "エラー",
        body: `「${goal}」の処理に失敗しました。`,
        severity: "high",
      },
      respectQuietHours: false,
    });
    return;
  }

  await updateTaskStatus(taskId, "running");
  console.info("[async-runner] start", { taskId, goal, delivery });

  try {
    const result = await chat(goal, undefined, undefined, userId);

    await updateTaskStatus(taskId, "completed", result.text);
    console.info("[async-runner] completed", { taskId });

    const shortGoal = goal.length > 25 ? `${goal.slice(0, 25)}…` : goal;
    await dispatch({
      channels,
      notification: {
        kind: "task-result",
        title: `完了: ${shortGoal}`,
        body: result.text,
        severity: "mid",
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      },
      respectQuietHours: true,
    });
  } catch (err) {
    const errMsg = String(err);
    await updateTaskStatus(taskId, "failed", undefined, errMsg);
    console.error("[async-runner] failed", { taskId, err: errMsg });

    await dispatch({
      channels,
      notification: {
        kind: "alert",
        title: "エラー",
        body: `「${goal}」の処理に失敗しました。`,
        severity: "high",
      },
      respectQuietHours: false,
    });
  }
};
