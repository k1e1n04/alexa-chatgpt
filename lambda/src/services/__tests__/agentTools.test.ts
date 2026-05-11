import { describe, it, expect, vi } from "vitest";
import { executeAgentTool, agentToolDefinitions } from "../tools/agentTools";

vi.mock("../asyncTaskClient", () => ({
  createAsyncTask: vi.fn().mockResolvedValue({ taskId: "task-test-123" }),
}));

describe("agentToolDefinitions", () => {
  it("make_plan と defer_to_async の定義を含む", () => {
    const names = agentToolDefinitions.map((t) => t.name);
    expect(names).toContain("make_plan");
    expect(names).toContain("defer_to_async");
  });

  it("make_plan の parameters に goal / steps / estimated_seconds が必須", () => {
    const def = agentToolDefinitions.find((t) => t.name === "make_plan")!;
    expect(def.parameters?.required).toEqual(
      expect.arrayContaining(["goal", "steps", "estimated_seconds"]),
    );
  });
});

describe("executeAgentTool", () => {
  it("make_plan: acknowledged=true と plan- プレフィクスの planId を返す", async () => {
    const result = await executeAgentTool(
      "make_plan",
      { goal: "旅行を計画する", steps: ["予定確認", "天気調査", "候補作成"], estimated_seconds: 15 },
      {},
    );
    const parsed = JSON.parse(result!);
    expect(parsed.acknowledged).toBe(true);
    expect(parsed.planId).toMatch(/^plan-\d+$/);
    expect(typeof parsed.message).toBe("string");
  });

  it("defer_to_async: createAsyncTask を呼び出して taskId を返す", async () => {
    const { createAsyncTask } = await import("../asyncTaskClient");
    const result = await executeAgentTool(
      "defer_to_async",
      {
        goal: "旅行候補を出す",
        plan: ["予定確認", "天気調査", "候補作成"],
        delivery: "both",
      },
      { userId: "amzn1.ask.account.test" },
    );
    const parsed = JSON.parse(result!);
    expect(parsed.taskId).toBe("task-test-123");
    expect(createAsyncTask).toHaveBeenCalledWith(
      "amzn1.ask.account.test",
      "旅行候補を出す",
      ["予定確認", "天気調査", "候補作成"],
    );
  });

  it("未知のツール名には null を返す", async () => {
    const result = await executeAgentTool("unknown_tool", {}, {});
    expect(result).toBeNull();
  });
});
