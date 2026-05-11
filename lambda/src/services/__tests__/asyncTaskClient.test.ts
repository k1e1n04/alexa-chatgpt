import { beforeEach, describe, expect, it, vi } from "vitest";

const sendMock = vi.fn();

vi.mock("@aws-sdk/client-dynamodb", () => ({
  DynamoDBClient: vi.fn(function DynamoDBClient() {
    return {};
  }),
}));

vi.mock("@aws-sdk/client-sfn", () => ({
  SFNClient: vi.fn(function SFNClient() {
    return { send: sendMock };
  }),
  StartExecutionCommand: vi.fn(function StartExecutionCommand(input) {
    return { input };
  }),
}));

vi.mock("@aws-sdk/lib-dynamodb", () => {
  class PutCommand {
    constructor(public input: unknown) {}
  }
  class UpdateCommand {
    constructor(public input: unknown) {}
  }
  class GetCommand {
    constructor(public input: unknown) {}
  }
  class QueryCommand {
    constructor(public input: unknown) {}
  }

  return {
    DynamoDBDocumentClient: {
      from: vi.fn(() => ({ send: sendMock })),
    },
    PutCommand,
    UpdateCommand,
    GetCommand,
    QueryCommand,
  };
});

describe("asyncTaskClient", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    delete process.env.ASYNC_AGENT_STATE_MACHINE_ARN;
    delete process.env.AGENT_TASKS_TABLE;
  });

  it("createAsyncTask: DynamoDB に pending タスクを保存する", async () => {
    sendMock.mockResolvedValueOnce({});
    const { createAsyncTask } = await import("../asyncTaskClient");

    const { taskId } = await createAsyncTask("user123", "テスト目的", ["ステップ1"]);

    expect(taskId).toMatch(/^task-\d+$/);
    expect(sendMock).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({
          TableName: "chappie-stg-agent-tasks",
          Item: expect.objectContaining({
            taskId,
            userId: "user123",
            goal: "テスト目的",
            plan: ["ステップ1"],
            status: "pending",
            ttl: expect.any(Number),
          }),
        }),
      }),
    );
  });

  it("createAsyncTask: state machine ARN があれば Step Functions を起動する", async () => {
    process.env.ASYNC_AGENT_STATE_MACHINE_ARN =
      "arn:aws:states:ap-northeast-1:123456789012:stateMachine:test";
    sendMock.mockResolvedValueOnce({}).mockResolvedValueOnce({});
    const { createAsyncTask } = await import("../asyncTaskClient");

    const { taskId } = await createAsyncTask("user123", "旅行候補", ["予定確認"]);

    expect(sendMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        input: expect.objectContaining({
          stateMachineArn: process.env.ASYNC_AGENT_STATE_MACHINE_ARN,
          name: taskId,
          input: expect.any(String),
        }),
      }),
    );
  });

  it("getPendingCompletedTasks: completed かつ未通知のタスク一覧を返す", async () => {
    sendMock.mockResolvedValue({
      Items: [{ taskId: "task-1", userId: "u1", goal: "旅行候補", status: "completed" }],
    });
    const { getPendingCompletedTasks } = await import("../asyncTaskClient");

    const tasks = await getPendingCompletedTasks("u1");

    expect(tasks).toEqual([
      expect.objectContaining({ taskId: "task-1", goal: "旅行候補", status: "completed" }),
    ]);
    expect(sendMock).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({
          IndexName: "userId-createdAt-index",
          KeyConditionExpression: "userId = :uid",
          FilterExpression: "#s = :s AND (attribute_not_exists(notified) OR notified = :f)",
        }),
      }),
    );
  });

  it("markTaskNotified: notified=true に更新する", async () => {
    sendMock.mockResolvedValueOnce({});
    const { markTaskNotified } = await import("../asyncTaskClient");

    await markTaskNotified("task-9");

    expect(sendMock).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({
          Key: { taskId: "task-9" },
          UpdateExpression: "SET notified = :t",
          ExpressionAttributeValues: { ":t": true },
        }),
      }),
    );
  });
});
