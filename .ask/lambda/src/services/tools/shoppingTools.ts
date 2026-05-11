import type OpenAI from "openai";
import * as pairpanel from "../pairpanel";

export const shoppingToolDefinitions: OpenAI.Responses.FunctionTool[] = [
  {
    type: "function",
    name: "get_shopping_list",
    description: "pairpanel のお買い物リストを取得する",
    parameters: { type: "object", properties: {}, required: [] },
  },
  {
    type: "function",
    name: "add_shopping_items",
    description: "pairpanel のお買い物リストに商品を追加する。1件でも複数件でもこのツールを使う",
    parameters: {
      type: "object",
      properties: {
        names: { type: "array", items: { type: "string" }, description: "追加する商品名のリスト" },
      },
      required: ["names"],
    },
  },
  {
    type: "function",
    name: "complete_all_shopping",
    description: "指定した ID のお買い物を一括完了する。事前に get_shopping_list で ID を取得すること",
    parameters: {
      type: "object",
      properties: {
        ids: { type: "array", items: { type: "string" }, description: "完了するお買い物の ID リスト" },
      },
      required: ["ids"],
    },
  },
];

export async function executeShoppingTool(
  name: string,
  args: Record<string, unknown>,
): Promise<string | null> {
  switch (name) {
    case "get_shopping_list": {
      const items = await pairpanel.getShoppingList();
      if (items.length === 0) return JSON.stringify({ items: [], message: "お買い物リストは空です" });
      return JSON.stringify({ items });
    }
    case "add_shopping_items": {
      const names = args.names as string[];
      const added = await Promise.all(names.map((n) => pairpanel.addShoppingItem(n)));
      const nameList = added.map((i) => i.name).join("、");
      return JSON.stringify({ added, message: `${nameList}をリストに追加しました` });
    }
    case "complete_all_shopping": {
      const ids = args.ids as string[];
      await pairpanel.completeAllShopping(ids);
      return JSON.stringify({ message: `${ids.length}件のお買い物を完了しました` });
    }
    default:
      return null;
  }
}
