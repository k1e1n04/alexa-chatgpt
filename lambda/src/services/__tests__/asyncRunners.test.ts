import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../openai", () => ({
  chat: vi.fn(),
}));

vi.mock("../notificationDispatcher", () => ({
  dispatch: vi.fn(),
}));

vi.mock("../asyncTaskClient", () => ({
  updateTaskStatus: vi.fn(),
}));

vi.mock("../briefing", () => ({
  getBriefingData: vi.fn(),
  buildBriefingContext: vi.fn(),
}));

describe("asyncRunner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("成功時はタスク完了と pairpanel 通知を行う", async () => {
    const { chat } = await import("../openai");
    const { dispatch } = await import("../notificationDispatcher");
    const { updateTaskStatus } = await import("../asyncTaskClient");
    vi.mocked(chat).mockResolvedValue({ text: "候補は3件です" });

    const { handler } = await import("../../asyncRunner");
    await handler({
      taskId: "task-1",
      userId: "user-1",
      goal: "旅行候補を出す",
      plan: ["予定確認"],
    });

    expect(updateTaskStatus).toHaveBeenNthCalledWith(1, "task-1", "running");
    expect(chat).toHaveBeenCalledWith("旅行候補を出す", undefined, undefined, "user-1");
    expect(updateTaskStatus).toHaveBeenNthCalledWith(2, "task-1", "completed", "候補は3件です");
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        channels: ["pairpanel"],
        notification: expect.objectContaining({
          kind: "task-result",
          body: "候補は3件です",
        }),
      }),
    );
  });

  it("失敗時は failed にして alert を送る", async () => {
    const { chat } = await import("../openai");
    const { dispatch } = await import("../notificationDispatcher");
    const { updateTaskStatus } = await import("../asyncTaskClient");
    vi.mocked(chat).mockRejectedValue(new Error("boom"));

    const { handler } = await import("../../asyncRunner");
    await handler({
      taskId: "task-2",
      userId: "user-1",
      goal: "旅行候補を出す",
      plan: ["予定確認"],
    });

    expect(updateTaskStatus).toHaveBeenNthCalledWith(1, "task-2", "running");
    expect(updateTaskStatus).toHaveBeenNthCalledWith(2, "task-2", "failed", undefined, "Error: boom");
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        notification: expect.objectContaining({
          kind: "alert",
        }),
      }),
    );
  });
});

describe("morningBriefingRunner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("ブリーフィング結果を通知し、雨予報なら追加リマインドする", async () => {
    const { getBriefingData, buildBriefingContext } = await import("../briefing");
    const { chat } = await import("../openai");
    const { dispatch } = await import("../notificationDispatcher");
    vi.mocked(getBriefingData).mockResolvedValue({
      weather: { description: "雨のちくもり", temperatureText: "20度" },
      events: [],
    } as never);
    vi.mocked(buildBriefingContext).mockReturnValue("ctx");
    vi.mocked(chat).mockResolvedValue({ text: "今日は傘を持ってください" });

    const { handler } = await import("../../morningBriefingRunner");
    await handler();

    expect(buildBriefingContext).toHaveBeenCalled();
    expect(chat).toHaveBeenCalledWith(
      expect.stringContaining("今日のブリーフィング"),
      undefined,
      "ctx",
      "morning-cron",
    );
    expect(dispatch).toHaveBeenCalledTimes(2);
  });
});
