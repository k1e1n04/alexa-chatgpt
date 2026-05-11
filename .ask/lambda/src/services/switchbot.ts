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
