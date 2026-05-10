# Design: SwitchBot & Slack Integration

Date: 2026-05-10

## Overview

Expand the Alexa-ChatGPT skill's external service integrations by adding SwitchBot (AC control) and Slack (messaging) as AI-callable tools. The AI will automatically decide when to call these tools based on user voice commands.

## Goals

- Enable voice control of air conditioner via SwitchBot API
- Enable sending Slack messages via voice command
- Maintain the existing tool-calling architecture without breaking changes

## Non-Goals

- Scene/macro orchestration (multiple devices in one command) — deferred
- Dynamic SwitchBot device discovery — deferred
- Multiple Slack channels or Slack Bot token — deferred

## Architecture

No structural changes to the handler or routing layer. Two new tool files are added, and `openai.ts` is updated to register them.

```
lambda/src/
├── services/
│   ├── openai.ts              ← add SwitchBot/Slack tools to CUSTOM_TOOLS; add dispatch cases
│   ├── switchbot.ts           ← NEW: SwitchBot API client (auth + device commands)
│   └── tools/
│       ├── shoppingTools.ts   (unchanged)
│       ├── calendarTools.ts   (unchanged)
│       ├── switchbotTools.ts  ← NEW: tool definitions + executeSwithcbotTool()
│       └── slackTools.ts      ← NEW: tool definitions + executeSlackTool()
```

## SwitchBot Integration

### API Authentication

SwitchBot API v1.1 requires HMAC-SHA256 signing per request:

```
sign = HMAC-SHA256(token + nonce + timestamp, secret)
Headers: Authorization: <token>, sign: <sign>, t: <timestamp>, nonce: <nonce>
```

Environment variables:
- `SWITCHBOT_TOKEN` — API token from SwitchBot app
- `SWITCHBOT_SECRET` — API secret from SwitchBot app
- `SWITCHBOT_AC_DEVICE_ID` — device ID of the air conditioner

### Tool Definitions

| Tool name | Description | Parameters |
|---|---|---|
| `turn_on_ac` | Turn on the air conditioner | `deviceId?: string` |
| `turn_off_ac` | Turn off the air conditioner | `deviceId?: string` |
| `set_ac_temperature` | Set AC temperature | `temperature: number`, `deviceId?: string` |
| `set_ac_mode` | Set AC mode | `mode: "cool" \| "heat" \| "auto" \| "fan"`, `deviceId?: string` |

`deviceId` defaults to `SWITCHBOT_AC_DEVICE_ID` env var when not specified, allowing single-AC households to skip it.

### SwitchBot API Endpoints Used

- `POST /v1.1/devices/{deviceId}/commands` — send a device command

AC command body examples:
```json
{ "command": "turnOn", "parameter": "default", "commandType": "command" }
{ "command": "setAll", "parameter": "26,1,3,on", "commandType": "command" }
```
`setAll` parameter format: `temperature,mode,fanSpeed,power` (mode: 1=auto,2=cool,3=heat,4=fan)

### `switchbot.ts` Responsibilities

- Build signed request headers
- Expose `sendDeviceCommand(deviceId, command, parameter)` function
- AC-specific helpers: `turnOn`, `turnOff`, `setTemperature`, `setMode`

## Slack Integration

### Authentication

Use Incoming Webhook URL — simplest setup, no OAuth required.

Environment variable:
- `SLACK_WEBHOOK_URL` — Incoming Webhook URL from Slack app settings

### Tool Definition

| Tool name | Description | Parameters |
|---|---|---|
| `send_slack_message` | Send a message to Slack | `message: string` |

No `channel` parameter needed for now since one webhook = one channel. The AI composes the message text naturally from user intent (e.g., "奈緒ちゃんに夜ご飯のことを伝えて" → AI writes the message body).

### Implementation

Simple `POST` to the Incoming Webhook URL with `{ "text": message }`.

## Environment Variables Summary

| Variable | Service | Description |
|---|---|---|
| `SWITCHBOT_TOKEN` | SwitchBot | API token |
| `SWITCHBOT_SECRET` | SwitchBot | API secret for HMAC signing |
| `SWITCHBOT_AC_DEVICE_ID` | SwitchBot | Device ID of the AC unit |
| `SLACK_WEBHOOK_URL` | Slack | Incoming Webhook URL |

All variables are optional at runtime — if absent, the corresponding tools are omitted from the tool list (same pattern as `ENABLE_WEB_SEARCH`).

## Error Handling

- SwitchBot/Slack failures are caught in `executeToolDispatch` and return `{ error: "..." }` JSON, same as existing tools
- AI will relay the error in natural speech
- No retry logic — Lambda timeout is 30s, API calls are fast (< 2s expected)

## Testing Approach

- Unit test `switchbot.ts` auth header generation with a known token/secret/timestamp
- Manual integration test: invoke via Alexa simulator with "エアコンをつけて"
