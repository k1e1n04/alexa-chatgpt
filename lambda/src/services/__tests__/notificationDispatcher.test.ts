import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../pairpanel", async (importOriginal) => {
  const original = await importOriginal<typeof import("../pairpanel")>();
  return { ...original, postNotification: vi.fn().mockResolvedValue(undefined) };
});

import { dispatch } from "../notificationDispatcher";
import * as pairpanel from "../pairpanel";

describe("dispatch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("pairpanel チャンネル: postNotification を呼ぶ", async () => {
    await dispatch({
      channels: ["pairpanel"],
      notification: { kind: "reminder", title: "テスト", body: "本文", severity: "low" },
      respectQuietHours: false,
    });
    expect(pairpanel.postNotification).toHaveBeenCalledOnce();
    expect(pairpanel.postNotification).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "reminder", title: "テスト" }),
    );
  });

  it("alexa-reminder チャンネル: quiet hours 外ならログを出す", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T01:00:00Z"));
    const infoSpy = vi.mocked(console.info);

    await dispatch({
      channels: ["alexa-reminder"],
      notification: { kind: "briefing", title: "朝のお知らせ", body: "天気は晴れ", severity: "low" },
      respectQuietHours: true,
    });

    expect(infoSpy).toHaveBeenCalledWith("[alexa-reminder stub]", "朝のお知らせ", "天気は晴れ");
    vi.useRealTimers();
  });

  it("quiet hours 中は alexa-reminder をスキップする（critical 以外）", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T14:00:00Z"));
    const infoSpy = vi.mocked(console.info);

    await dispatch({
      channels: ["alexa-reminder"],
      notification: { kind: "reminder", title: "リマインダー", body: "買い物", severity: "mid" },
      respectQuietHours: true,
    });

    expect(infoSpy).toHaveBeenCalledWith("[notification] quiet hours, skipping alexa-reminder");
    vi.useRealTimers();
  });

  it("critical 通知は quiet hours でも alexa-reminder を配信する", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T14:00:00Z"));
    const infoSpy = vi.mocked(console.info);

    await dispatch({
      channels: ["alexa-reminder"],
      notification: { kind: "alert", title: "緊急", body: "異常検知", severity: "critical" },
      respectQuietHours: true,
    });

    expect(infoSpy).toHaveBeenCalledWith("[alexa-reminder stub]", "緊急", "異常検知");
    vi.useRealTimers();
  });

  it("複数チャンネル同時配信: pairpanel と alexa-reminder 両方実行する", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T01:00:00Z"));
    const infoSpy = vi.mocked(console.info);

    await dispatch({
      channels: ["pairpanel", "alexa-reminder"],
      notification: { kind: "task-result", title: "完了", body: "旅行候補が出ました", severity: "mid" },
      respectQuietHours: false,
    });

    expect(pairpanel.postNotification).toHaveBeenCalledOnce();
    expect(infoSpy).toHaveBeenCalledWith("[alexa-reminder stub]", "完了", "旅行候補が出ました");
    vi.useRealTimers();
  });
});
