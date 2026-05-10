import { createHmac, randomUUID } from "crypto";

const TOKEN = process.env.SWITCHBOT_TOKEN;
const SECRET = process.env.SWITCHBOT_SECRET;

if (!TOKEN || !SECRET) {
  console.error("環境変数 SWITCHBOT_TOKEN と SWITCHBOT_SECRET を設定してください");
  console.error("  SwitchBotアプリ → プロフィール → 開発者向けオプション で取得できます");
  process.exit(1);
}

const t = Date.now();
const nonce = randomUUID();
const data = TOKEN + String(t) + nonce;
const sign = createHmac("sha256", SECRET).update(data).digest("base64");

const res = await fetch("https://api.switch-bot.com/v1.1/devices", {
  headers: {
    Authorization: TOKEN,
    sign,
    t: String(t),
    nonce,
    "Content-Type": "application/json",
  },
});

if (!res.ok) {
  console.error(`SwitchBot API エラー: ${res.status} ${res.statusText}`);
  process.exit(1);
}

const { body } = await res.json();
const devices = [...(body.deviceList ?? []), ...(body.infraredRemoteList ?? [])];

if (devices.length === 0) {
  console.log("デバイスが見つかりませんでした");
  process.exit(0);
}

console.log("\n=== デバイス一覧 ===\n");
for (const d of devices) {
  console.log(`名前: ${d.deviceName}`);
  console.log(`ID:   ${d.deviceId}`);
  console.log(`種類: ${d.deviceType ?? d.remoteType ?? "不明"}`);
  console.log("");
}

const map = Object.fromEntries(devices.map((d) => [d.deviceName, d.deviceId]));
console.log("=== SWITCHBOT_DEVICES 用 JSON ===\n");
console.log(JSON.stringify(map, null, 2));
console.log("\nこの JSON を Lambda 環境変数 SWITCHBOT_DEVICES に設定してください。");
console.log("不要なデバイスは削除して、名前を日本語に変えることもできます。");
