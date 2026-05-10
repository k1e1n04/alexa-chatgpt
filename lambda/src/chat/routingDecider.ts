const RESEARCH_KEYWORDS_SUFFIX = ["調べて", "調べといて", "検索して", "探して", "リサーチして", "について", "とは何", "とは", "って何"];
const RESEARCH_KEYWORDS_CONTAINS = ["ってどんな", "ってどういう", "について教えて"];

// デバイス操作や行動コマンドは research モードに入れない
const COMMAND_KEYWORDS_SUFFIX = ["つけて", "消して", "オンにして", "オフにして", "設定して", "にして", "送って", "開けて", "閉めて", "止めて"];

export function isCommandQuery(query: string): boolean {
  return COMMAND_KEYWORDS_SUFFIX.some((kw) => query.endsWith(kw));
}

export function isResearchQuery(query: string): boolean {
  if (isCommandQuery(query)) return false;
  if (RESEARCH_KEYWORDS_SUFFIX.some((kw) => query.endsWith(kw))) return true;
  if (RESEARCH_KEYWORDS_CONTAINS.some((kw) => query.includes(kw))) return true;
  return false;
}

const BRIEFING_KEYWORDS = ["おはよう", "今日の予定", "今日の天気", "今日どう", "今朝"];

export function isBriefingQuery(query: string): boolean {
  return BRIEFING_KEYWORDS.some((kw) => query.includes(kw));
}
