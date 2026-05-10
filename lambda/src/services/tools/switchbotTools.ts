import type OpenAI from "openai";
import { turnOnAc, turnOffAc, setAcTemperature, setAcMode } from "../switchbot";

export const switchbotToolDefinitions: OpenAI.Responses.FunctionTool[] = [
  {
    type: "function",
    name: "turn_on_ac",
    description: "エアコンをつける",
    parameters: {
      type: "object",
      properties: {
        deviceId: { type: "string", description: "デバイスID（省略時は環境変数から取得）" },
      },
      required: [],
    },
  },
  {
    type: "function",
    name: "turn_off_ac",
    description: "エアコンを消す",
    parameters: {
      type: "object",
      properties: {
        deviceId: { type: "string", description: "デバイスID（省略時は環境変数から取得）" },
      },
      required: [],
    },
  },
  {
    type: "function",
    name: "set_ac_temperature",
    description: "エアコンの温度を設定する",
    parameters: {
      type: "object",
      properties: {
        temperature: { type: "number", description: "設定温度（摂氏）" },
        deviceId: { type: "string", description: "デバイスID（省略時は環境変数から取得）" },
      },
      required: ["temperature"],
    },
  },
  {
    type: "function",
    name: "set_ac_mode",
    description: "エアコンのモードを変える（冷房・暖房・自動・送風）",
    parameters: {
      type: "object",
      properties: {
        mode: {
          type: "string",
          enum: ["cool", "heat", "auto", "fan"],
          description: "cool=冷房, heat=暖房, auto=自動, fan=送風",
        },
        deviceId: { type: "string", description: "デバイスID（省略時は環境変数から取得）" },
      },
      required: ["mode"],
    },
  },
];

export async function executeSwitchbotTool(
  name: string,
  args: Record<string, unknown>,
): Promise<string | null> {
  const deviceId = args.deviceId as string | undefined;
  switch (name) {
    case "turn_on_ac":
      return JSON.stringify({ message: await turnOnAc(deviceId) });
    case "turn_off_ac":
      return JSON.stringify({ message: await turnOffAc(deviceId) });
    case "set_ac_temperature": {
      const temp = args.temperature as number;
      return JSON.stringify({ message: await setAcTemperature(temp, deviceId) });
    }
    case "set_ac_mode": {
      const mode = args.mode as "cool" | "heat" | "auto" | "fan";
      return JSON.stringify({ message: await setAcMode(mode, deviceId) });
    }
    default:
      return null;
  }
}
