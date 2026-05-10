import type OpenAI from "openai";
import * as googleCalendar from "../googleCalendar";

export const calendarToolDefinitions: OpenAI.Responses.FunctionTool[] = [
  {
    type: "function",
    name: "get_today_events",
    description: "今日の Google カレンダーの予定一覧を取得する",
    parameters: { type: "object", properties: {}, required: [] },
  },
  {
    type: "function",
    name: "add_calendar_event",
    description: "Google カレンダーに予定を追加する",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "予定のタイトル" },
        start_time: { type: "string", description: "開始日時 (ISO 8601 JST例: 2026-05-10T15:00:00+09:00)" },
        end_time: { type: "string", description: "終了日時 (ISO 8601 JST例: 2026-05-10T16:00:00+09:00)" },
      },
      required: ["title", "start_time", "end_time"],
    },
  },
];

export async function executeCalendarTool(
  name: string,
  args: Record<string, unknown>,
): Promise<string | null> {
  switch (name) {
    case "get_today_events": {
      const events = await googleCalendar.getTodayEvents();
      if (events.length === 0) return JSON.stringify({ events: [], message: "今日の予定はありません" });
      return JSON.stringify({ events });
    }
    case "add_calendar_event": {
      const title = args.title as string;
      const startTime = args.start_time as string;
      const endTime = args.end_time as string;
      await googleCalendar.addCalendarEvent(title, startTime, endTime);
      return JSON.stringify({ message: `「${title}」をカレンダーに追加しました` });
    }
    default:
      return null;
  }
}
