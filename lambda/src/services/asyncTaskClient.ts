export async function createAsyncTask(
  userId: string,
  goal: string,
  plan: string[],
): Promise<{ taskId: string }> {
  const taskId = `task-${Date.now()}`;
  console.info("[async-task stub] created", { taskId, userId, goal, plan });
  return { taskId };
}
