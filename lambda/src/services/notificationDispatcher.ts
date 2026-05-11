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
        if (quiet) {
          console.info("[notification] quiet hours, skipping alexa-reminder");
          return;
        }
        console.info("[alexa-reminder stub]", notification.title, notification.body);
      }
    }),
  );
}
