import type OpenAI from "openai";
import { sendDeviceCommand } from "../switchbot";

function parseDeviceMap(): Record<string, string> {
  const raw = process.env.SWITCHBOT_DEVICES;
  if (raw) {
    try {
      return JSON.parse(raw) as Record<string, string>;
    } catch {
      console.error("SWITCHBOT_DEVICES parse error");
    }
  }
  // backward compat: single AC device
  const single = process.env.SWITCHBOT_AC_DEVICE_ID;
  if (single) return { エアコン: single };
  return {};
}

const deviceMap = parseDeviceMap();
const deviceNames = Object.keys(deviceMap);

function resolveDeviceId(deviceName: string): string {
  const id = deviceMap[deviceName];
  if (!id) throw new Error(`デバイス "${deviceName}" が見つかりません`);
  return id;
}

const MODE_MAP: Record<string, number> = { auto: 1, cool: 2, heat: 3, fan: 4 };
const MODE_LABEL: Record<string, string> = { cool: "冷房", heat: "暖房", auto: "自動", fan: "送風" };

const deviceEnum = deviceNames.length > 0
  ? { enum: deviceNames }
  : { type: "string" as const };

export const switchbotToolDefinitions: OpenAI.Responses.FunctionTool[] =
  deviceNames.length === 0
    ? []
    : [
        {
          type: "function",
          name: "turn_on_device",
          description: `SwitchBotデバイスをオンにする。利用可能: ${deviceNames.join("、")}`,
          strict: false,
          parameters: {
            type: "object",
            properties: {
              deviceName: { ...deviceEnum, description: "操作するデバイス名" },
            },
            required: ["deviceName"],
          },
        },
        {
          type: "function",
          name: "turn_off_device",
          description: `SwitchBotデバイスをオフにする。利用可能: ${deviceNames.join("、")}`,
          strict: false,
          parameters: {
            type: "object",
            properties: {
              deviceName: { ...deviceEnum, description: "操作するデバイス名" },
            },
            required: ["deviceName"],
          },
        },
        {
          type: "function",
          name: "set_ac_temperature",
          description: "エアコンの温度を設定する（冷房モードで動作）",
          strict: false,
          parameters: {
            type: "object",
            properties: {
              temperature: { type: "number", description: "設定温度（摂氏）" },
              deviceName: { ...deviceEnum, description: "操作するデバイス名" },
            },
            required: ["temperature", "deviceName"],
          },
        },
        {
          type: "function",
          name: "set_ac_mode",
          description: "エアコンのモードを変える",
          strict: false,
          parameters: {
            type: "object",
            properties: {
              mode: {
                type: "string",
                enum: ["cool", "heat", "auto", "fan"],
                description: "cool=冷房, heat=暖房, auto=自動, fan=送風",
              },
              deviceName: { ...deviceEnum, description: "操作するデバイス名" },
            },
            required: ["mode", "deviceName"],
          },
        },
      ];

export async function executeSwitchbotTool(
  name: string,
  args: Record<string, unknown>,
): Promise<string | null> {
  switch (name) {
    case "turn_on_device": {
      const id = resolveDeviceId(args.deviceName as string);
      await sendDeviceCommand(id, "turnOn");
      return JSON.stringify({ message: `${args.deviceName}をつけました` });
    }
    case "turn_off_device": {
      const id = resolveDeviceId(args.deviceName as string);
      await sendDeviceCommand(id, "turnOff");
      return JSON.stringify({ message: `${args.deviceName}を消しました` });
    }
    case "set_ac_temperature": {
      const id = resolveDeviceId(args.deviceName as string);
      const temp = args.temperature as number;
      await sendDeviceCommand(id, "setAll", `${temp},2,0,on`);
      return JSON.stringify({ message: `${args.deviceName}の温度を${temp}度に設定しました` });
    }
    case "set_ac_mode": {
      const id = resolveDeviceId(args.deviceName as string);
      const mode = args.mode as string;
      const modeNum = MODE_MAP[mode] ?? 1;
      await sendDeviceCommand(id, "setAll", `26,${modeNum},0,on`);
      return JSON.stringify({ message: `${args.deviceName}を${MODE_LABEL[mode] ?? mode}モードにしました` });
    }
    default:
      return null;
  }
}
