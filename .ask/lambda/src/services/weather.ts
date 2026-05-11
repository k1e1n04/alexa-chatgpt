const WMO_CODE_MAP: Record<number, string> = {
  0: "快晴",
  1: "晴れ",
  2: "一部曇り",
  3: "曇り",
  45: "霧",
  48: "霧",
  51: "霧雨",
  53: "霧雨",
  55: "霧雨",
  61: "雨",
  63: "雨",
  65: "大雨",
  71: "雪",
  73: "雪",
  75: "大雪",
  77: "みぞれ",
  80: "にわか雨",
  81: "にわか雨",
  82: "激しいにわか雨",
  85: "にわか雪",
  86: "激しいにわか雪",
  95: "雷雨",
  96: "雷雨",
  99: "激しい雷雨",
};

export interface WeatherForecast {
  description: string;
}

export async function getWeatherForecast(): Promise<WeatherForecast> {
  const lat = process.env.WEATHER_LAT ?? "35.6895";
  const lon = process.env.WEATHER_LON ?? "139.6917";

  const url =
    `https://api.open-meteo.com/v1/forecast` +
    `?latitude=${lat}&longitude=${lon}` +
    `&daily=weathercode,temperature_2m_max,temperature_2m_min` +
    `&timezone=Asia%2FTokyo&forecast_days=1`;

  const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
  if (!res.ok) throw new Error(`weather API error: ${res.status}`);

  const data = (await res.json()) as {
    daily: {
      weathercode: number[];
      temperature_2m_max: number[];
      temperature_2m_min: number[];
    };
  };

  const code = data.daily.weathercode[0] ?? 0;
  const max = Math.round(data.daily.temperature_2m_max[0] ?? 0);
  const min = Math.round(data.daily.temperature_2m_min[0] ?? 0);
  const weatherLabel = WMO_CODE_MAP[code] ?? "不明";

  return { description: `${weatherLabel}、最高${max}度、最低${min}度` };
}
