import { describe, it, expect, vi } from "vitest";
import { createAsyncTask } from "../asyncTaskClient";

describe("createAsyncTask", () => {
  it("task- プレフィクスのついた taskId を返す", async () => {
    const { taskId } = await createAsyncTask("user123", "テスト目的", ["ステップ1"]);
    expect(taskId).toMatch(/^task-\d+$/);
  });

  it("タスク生成時に console.info でログを出す", async () => {
    const spy = vi.spyOn(console, "info").mockImplementation(() => {});
    await createAsyncTask("user123", "テスト", ["ステップ1"]);
    expect(spy).toHaveBeenCalledWith(
      "[async-task stub] created",
      expect.objectContaining({ userId: "user123", goal: "テスト" }),
    );
    spy.mockRestore();
  });
});
