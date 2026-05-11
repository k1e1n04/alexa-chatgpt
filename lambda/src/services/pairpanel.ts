const BASE_URL = process.env.PAIRPANEL_API_URL ?? "";
const API_GATEWAY_KEY = process.env.PAIRPANEL_API_GATEWAY_KEY ?? "";
const USER_ID = process.env.PAIRPANEL_USER_ID ?? "";
const PAIR_ID = process.env.PAIRPANEL_PAIR_ID ?? "";

const headers = (): Record<string, string> => {
  const h: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Api-Key": API_GATEWAY_KEY,
    "X-User-Id": USER_ID,
  };
  if (PAIR_ID) h["X-Pair-Id"] = PAIR_ID;
  return h;
};

export interface ShoppingItem {
  id: string;
  name: string;
}

export interface PairpanelNotification {
  kind: "briefing" | "reminder" | "task-result" | "alert";
  title: string;
  body: string;
  severity: "low" | "mid" | "high" | "critical";
  expiresAt?: string;
}

export async function getShoppingList(): Promise<ShoppingItem[]> {
  const res = await fetch(`${BASE_URL}/api/v1/alexa/shopping`, {
    headers: headers(),
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`getShoppingList failed: ${res.status}`);
  const data = (await res.json()) as { id: string; name: string }[];
  return data.map((item) => ({ id: item.id, name: item.name }));
}

export async function addShoppingItem(name: string): Promise<ShoppingItem> {
  const res = await fetch(`${BASE_URL}/api/v1/alexa/shopping/register`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ name, isShared: true }),
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`addShoppingItem failed: ${res.status}`);
  const data = (await res.json()) as { id: string; name: string };
  return { id: data.id, name: data.name };
}

export async function completeAllShopping(ids: string[]): Promise<void> {
  const res = await fetch(`${BASE_URL}/api/v1/alexa/shopping/complete-all`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ shoppingIds: ids }),
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`completeAllShopping failed: ${res.status}`);
}

export async function postNotification(
  notification: PairpanelNotification,
): Promise<void> {
  const res = await fetch(`${BASE_URL}/api/v1/alexa/notifications`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(notification),
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) {
    console.warn(`[pairpanel] postNotification failed: ${res.status}`);
  }
}
