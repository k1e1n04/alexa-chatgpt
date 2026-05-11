import { getTodayEvents, CalendarEvent } from "./googleCalendar";
import { getWeatherForecast, WeatherForecast } from "./weather";

export interface BriefingData {
  weather: WeatherForecast | null;
  events: CalendarEvent[];
}

export async function getBriefingData(): Promise<BriefingData> {
  const [weatherResult, eventsResult] = await Promise.allSettled([
    getWeatherForecast(),
    getTodayEvents(),
  ]);

  return {
    weather: weatherResult.status === "fulfilled" ? weatherResult.value : null,
    events: eventsResult.status === "fulfilled" ? eventsResult.value : [],
  };
}

export function buildBriefingContext(data: BriefingData): string {
  const parts: string[] = [];
  if (data.weather) {
    parts.push(`今日の天気: ${data.weather.description}`);
  }
  if (data.events.length > 0) {
    const eventList = data.events
      .map((e) => {
        const time = e.start.includes("T")
          ? new Date(e.start).toLocaleTimeString("ja-JP", {
              hour: "2-digit",
              minute: "2-digit",
              timeZone: "Asia/Tokyo",
            })
          : "終日";
        return `${time} ${e.title}`;
      })
      .join("、");
    parts.push(`今日の予定: ${eventList}`);
  } else {
    parts.push("今日の予定: なし");
  }
  return parts.join("\n");
}
