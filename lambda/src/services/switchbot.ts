import { createHmac, randomUUID } from "crypto";

const BASE_URL = "https://api.switch-bot.com/v1.1";

export function buildSignedHeaders(
  token: string,
  secret: string,
  timestamp: number = Date.now(),
  nonce: string = randomUUID(),
): Record<string, string> {
  const data = token + String(timestamp) + nonce;
  const sign = createHmac("sha256", secret).update(data).digest("base64");
  return {
    Authorization: token,
    sign,
    t: String(timestamp),
    nonce,
    "Content-Type": "application/json",
  };
}

export async function sendDeviceCommand(
  deviceId: string,
  command: string,
  parameter: string = "default",
): Promise<void> {
  const token = process.env.SWITCHBOT_TOKEN ?? "";
  const secret = process.env.SWITCHBOT_SECRET ?? "";
  const headers = buildSignedHeaders(token, secret);

  const res = await fetch(`${BASE_URL}/devices/${deviceId}/commands`, {
    method: "POST",
    headers,
    body: JSON.stringify({ command, parameter, commandType: "command" }),
  });

  if (!res.ok) {
    throw new Error(`SwitchBot API error: ${res.status}`);
  }
}

function getDefaultDeviceId(): string {
  const id = process.env.SWITCHBOT_AC_DEVICE_ID;
  if (!id) throw new Error("SWITCHBOT_AC_DEVICE_ID is not set");
  return id;
}

export async function turnOnAc(deviceId?: string): Promise<string> {
  await sendDeviceCommand(deviceId ?? getDefaultDeviceId(), "turnOn");
  return "エアコンをつけました";
}

export async function turnOffAc(deviceId?: string): Promise<string> {
  await sendDeviceCommand(deviceId ?? getDefaultDeviceId(), "turnOff");
  return "エアコンを消しました";
}

// mode: 1=auto, 2=cool, 3=heat, 4=fan
const MODE_MAP: Record<string, number> = { auto: 1, cool: 2, heat: 3, fan: 4 };

export async function setAcTemperature(
  temperature: number,
  deviceId?: string,
): Promise<string> {
  // setAll format: temperature,mode,fanSpeed,power
  await sendDeviceCommand(
    deviceId ?? getDefaultDeviceId(),
    "setAll",
    `${temperature},2,0,on`,
  );
  return `エアコンの温度を${temperature}度に設定しました`;
}

export async function setAcMode(
  mode: "cool" | "heat" | "auto" | "fan",
  deviceId?: string,
): Promise<string> {
  const modeNum = MODE_MAP[mode] ?? 1;
  await sendDeviceCommand(
    deviceId ?? getDefaultDeviceId(),
    "setAll",
    `26,${modeNum},0,on`,
  );
  const modeLabel: Record<string, string> = {
    cool: "冷房",
    heat: "暖房",
    auto: "自動",
    fan: "送風",
  };
  return `エアコンを${modeLabel[mode] ?? mode}モードにしました`;
}
