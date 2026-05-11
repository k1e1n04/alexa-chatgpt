import { postNotification, type PairpanelNotification } from "./pairpanel";

export type NotificationPayload = PairpanelNotification;

export interface DispatchOptions {
  channels: Array<"pairpanel" | "alexa-reminder">;
  notification: NotificationPayload;
  respectQuietHours: boolean;
}

function isQuietHour(): boolean {
  const hour = parseInt(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Tokyo",
      hour: "numeric",
      hour12: false,
    }).format(new Date()),
    10,
  );
  return hour >= 22 || hour < 7;
}

export async function dispatch(opts: DispatchOptions): Promise<void> {
  const { channels, notification, respectQuietHours } = opts;
  const quiet = respectQuietHours && isQuietHour() && notification.severity !== "critical";

  await Promise.allSettled(
    channels.map(async (channel) => {
      if (channel === "pairpanel") {
        await postNotification(notification);
      } else if (channel === "alexa-reminder") {
        // Alexa への push 通知は LaunchRequestHandler の getPendingCompletedTasks で実現する。
        // タスクが completed になれば次回スキル起動時に自動アナウンスされる。
        if (quiet) {
          console.info("[alexa-reminder] quiet hours - will announce on next skill launch:", notification.title);
          return;
        }
        console.info("[alexa-reminder] will announce on next skill launch:", notification.title);
      }
    }),
  );
}
