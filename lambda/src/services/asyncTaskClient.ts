import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { SFNClient, StartExecutionCommand } from "@aws-sdk/client-sfn";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";

const REGION = process.env.AWS_REGION ?? "ap-northeast-1";
const TABLE_NAME = process.env.AGENT_TASKS_TABLE ?? "chappie-stg-agent-tasks";
const STATE_MACHINE_ARN = process.env.ASYNC_AGENT_STATE_MACHINE_ARN ?? "";

const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));
const sfn = new SFNClient({ region: REGION });

export type TaskStatus = "pending" | "running" | "completed" | "failed";

export interface AgentTask {
  taskId: string;
  userId: string;
  goal: string;
  plan: string[];
  delivery?: string;
  status: TaskStatus;
  result?: string;
  createdAt: string;
  completedAt?: string;
  error?: string;
  ttl: number;
  notified?: boolean;
}

export async function createAsyncTask(
  userId: string,
  goal: string,
  plan: string[],
  delivery?: string,
): Promise<{ taskId: string }> {
  const taskId = `task-${Date.now()}`;
  const createdAt = new Date().toISOString();
  const ttl = Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60;

  await dynamo.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: { taskId, userId, goal, plan, status: "pending", createdAt, ttl, ...(delivery ? { delivery } : {}) },
    }),
  );

  if (STATE_MACHINE_ARN) {
    await sfn.send(
      new StartExecutionCommand({
        stateMachineArn: STATE_MACHINE_ARN,
        name: taskId,
        input: JSON.stringify({ taskId, userId, goal, plan, ...(delivery ? { delivery } : {}) }),
      }),
    );
  } else {
    console.warn("[async-task] ASYNC_AGENT_STATE_MACHINE_ARN not set - skipping Step Functions");
  }

  console.info("[async-task] created", { taskId, userId, goal, delivery });
  return { taskId };
}

export async function updateTaskStatus(
  taskId: string,
  status: TaskStatus,
  result?: string,
  error?: string,
): Promise<void> {
  const completedAt =
    status === "completed" || status === "failed" ? new Date().toISOString() : undefined;

  await dynamo.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { taskId },
      UpdateExpression:
        "SET #s = :s" +
        (result !== undefined ? ", #r = :r" : "") +
        (error !== undefined ? ", #e = :e" : "") +
        (completedAt ? ", completedAt = :ca" : ""),
      ExpressionAttributeNames: {
        "#s": "status",
        ...(result !== undefined ? { "#r": "result" } : {}),
        ...(error !== undefined ? { "#e": "error" } : {}),
      },
      ExpressionAttributeValues: {
        ":s": status,
        ...(result !== undefined ? { ":r": result } : {}),
        ...(error !== undefined ? { ":e": error } : {}),
        ...(completedAt ? { ":ca": completedAt } : {}),
      },
    }),
  );
}

export async function getTask(taskId: string): Promise<AgentTask | null> {
  const res = await dynamo.send(new GetCommand({ TableName: TABLE_NAME, Key: { taskId } }));
  return (res.Item as AgentTask) ?? null;
}

export async function getPendingCompletedTasks(userId: string): Promise<AgentTask[]> {
  const res = await dynamo.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      IndexName: "userId-createdAt-index",
      KeyConditionExpression: "userId = :uid",
      FilterExpression: "#s = :s AND (attribute_not_exists(notified) OR notified = :f)",
      ExpressionAttributeNames: { "#s": "status" },
      ExpressionAttributeValues: { ":uid": userId, ":s": "completed", ":f": false },
      Limit: 5,
    }),
  );

  return (res.Items ?? []) as AgentTask[];
}

export async function markTaskNotified(taskId: string): Promise<void> {
  await dynamo.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { taskId },
      UpdateExpression: "SET notified = :t",
      ExpressionAttributeValues: { ":t": true },
    }),
  );
}
