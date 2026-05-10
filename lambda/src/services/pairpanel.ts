const BASE_URL = process.env.PAIRPANEL_API_URL ?? "";
const API_KEY = process.env.PAIRPANEL_API_KEY ?? "";

const headers = () => ({
  "Content-Type": "application/json",
  "X-Api-Key": API_KEY,
});

export interface ShoppingItem {
  id: string;
  name: string;
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
    body: JSON.stringify({ name, isShared: false }),
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
