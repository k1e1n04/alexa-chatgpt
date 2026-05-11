import { google } from "@googleapis/calendar";

const CALENDAR_ID = "primary";
const TIME_ZONE = "Asia/Tokyo";

function getCalendar() {
  const auth = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
  );
  auth.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
  return google.calendar({ version: "v3", auth });
}

export interface CalendarEvent {
  title: string;
  start: string;
  end: string;
}

export async function getTodayEvents(): Promise<CalendarEvent[]> {
  const calendar = getCalendar();
  const now = new Date();
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(now);
  endOfDay.setHours(23, 59, 59, 999);

  const res = await calendar.events.list({
    calendarId: CALENDAR_ID,
    timeMin: startOfDay.toISOString(),
    timeMax: endOfDay.toISOString(),
    singleEvents: true,
    orderBy: "startTime",
    timeZone: TIME_ZONE,
  });

  return (res.data.items ?? []).map((e) => ({
    title: e.summary ?? "(タイトルなし)",
    start: e.start?.dateTime ?? e.start?.date ?? "",
    end: e.end?.dateTime ?? e.end?.date ?? "",
  }));
}

export async function getEventsByDate(dateStr: string): Promise<CalendarEvent[]> {
  const calendar = getCalendar();
  const date = new Date(dateStr);
  const startOfDay = new Date(date);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(date);
  endOfDay.setHours(23, 59, 59, 999);

  const res = await calendar.events.list({
    calendarId: CALENDAR_ID,
    timeMin: startOfDay.toISOString(),
    timeMax: endOfDay.toISOString(),
    singleEvents: true,
    orderBy: "startTime",
    timeZone: TIME_ZONE,
  });

  return (res.data.items ?? []).map((e) => ({
    title: e.summary ?? "(タイトルなし)",
    start: e.start?.dateTime ?? e.start?.date ?? "",
    end: e.end?.dateTime ?? e.end?.date ?? "",
  }));
}

export async function addCalendarEvent(
  title: string,
  startTime: string,
  endTime: string,
): Promise<void> {
  const calendar = getCalendar();
  await calendar.events.insert({
    calendarId: CALENDAR_ID,
    requestBody: {
      summary: title,
      start: { dateTime: startTime, timeZone: TIME_ZONE },
      end: { dateTime: endTime, timeZone: TIME_ZONE },
    },
  });
}
