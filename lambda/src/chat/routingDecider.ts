const RESEARCH_KEYWORDS_SUFFIX = ["調べて", "調べといて", "検索して", "探して", "リサーチして", "について", "とは何", "とは", "って何"];
const RESEARCH_KEYWORDS_CONTAINS = ["ってどんな", "ってどういう", "について教えて"];

export function isResearchQuery(query: string): boolean {
  if (RESEARCH_KEYWORDS_SUFFIX.some((kw) => query.endsWith(kw))) return true;
  if (RESEARCH_KEYWORDS_CONTAINS.some((kw) => query.includes(kw))) return true;
  return false;
}
