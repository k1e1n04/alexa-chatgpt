import * as pairpanel from "./pairpanel";
import * as googleCalendar from "./googleCalendar";

export async function executeTool(
  name: string,
  args: Record<string, unknown>,
): Promise<string> {
  switch (name) {
    case "get_shopping_list": {
      const items = await pairpanel.getShoppingList();
      if (items.length === 0) return JSON.stringify({ items: [], message: "お買い物リストは空です" });
      return JSON.stringify({ items });
    }
    case "add_shopping_item": {
      const itemName = args.name as string;
      const added = await pairpanel.addShoppingItem(itemName);
      return JSON.stringify({ added, message: `${added.name}をリストに追加しました` });
    }
    case "complete_all_shopping": {
      const ids = args.ids as string[];
      await pairpanel.completeAllShopping(ids);
      return JSON.stringify({ message: `${ids.length}件のお買い物を完了しました` });
    }
    case "get_today_events": {
      const events = await googleCalendar.getTodayEvents();
      if (events.length === 0) return JSON.stringify({ events: [], message: "今日の予定はありません" });
      return JSON.stringify({ events });
    }
    case "add_calendar_event": {
      const title = args.title as string;
      const startTime = args.start_time as string;
      const endTime = args.end_time as string;
      await googleCalendar.addCalendarEvent(title, startTime, endTime);
      return JSON.stringify({ message: `「${title}」をカレンダーに追加しました` });
    }
    default:
      return JSON.stringify({ error: `未知の関数: ${name}` });
  }
}
