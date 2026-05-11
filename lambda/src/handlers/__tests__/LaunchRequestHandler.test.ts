import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../services/memory", () => ({
  getMemory: vi.fn(),
}));

vi.mock("../../services/asyncTaskClient", () => ({
  getPendingCompletedTasks: vi.fn(),
  markTaskNotified: vi.fn(),
}));

describe("LaunchRequestHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("未通知の完了タスクがあれば起動時に案内する", async () => {
    const { getMemory } = await import("../../services/memory");
    const { getPendingCompletedTasks, markTaskNotified } = await import(
      "../../services/asyncTaskClient"
    );
    vi.mocked(getMemory).mockResolvedValue("memory");
    vi.mocked(getPendingCompletedTasks).mockResolvedValue([
      { taskId: "task-1", goal: "来週の旅行候補を出して", status: "completed" },
    ] as never);
    vi.mocked(markTaskNotified).mockResolvedValue(undefined);

    const speak = vi.fn().mockReturnThis();
    const reprompt = vi.fn().mockReturnThis();
    const withAskForPermissionsConsentCard = vi.fn().mockReturnThis();
    const getResponse = vi.fn().mockReturnValue({ ok: true });

    const { LaunchRequestHandler } = await import("../LaunchRequestHandler");
    const response = await LaunchRequestHandler.handle({
      requestEnvelope: {
        request: { type: "LaunchRequest" },
        context: {
          System: {
            user: {
              userId: "user-1",
              permissions: {
                scopes: {
                  "alexa::alerts:reminders:skill:readwrite": { status: "GRANTED" },
                },
              },
            },
          },
        },
      },
      attributesManager: {
        getSessionAttributes: vi.fn().mockReturnValue({}),
        setSessionAttributes: vi.fn(),
      },
      responseBuilder: {
        speak,
        reprompt,
        withAskForPermissionsConsentCard,
        getResponse,
      },
    } as never);

    expect(getPendingCompletedTasks).toHaveBeenCalledWith("user-1");
    expect(speak).toHaveBeenCalledWith(
      expect.stringContaining("来週の旅行候補を出して"),
    );
    expect(markTaskNotified).toHaveBeenCalledWith("task-1");
    expect(response).toEqual({ ok: true });
  });
});
