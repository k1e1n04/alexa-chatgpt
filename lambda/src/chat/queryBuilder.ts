import { isResearchQuery, isBriefingQuery, isCommandQuery } from "./routingDecider";

export interface SlotValues {
  rawQuery: string;
  topicQuery: string;
  shopItem: string;
  shopAction: string;
}

export interface QueryBuildResult {
  query: string;
  researchMode: boolean;
  briefingMode: boolean;
  isLaunchPhrase: boolean;
}

const LAUNCH_PHRASES = ["を開いて", "開いて", "を起動して", "起動して"];

export function buildQuery(slots: SlotValues): QueryBuildResult {
  const { rawQuery, topicQuery, shopItem, shopAction } = slots;

  let query: string;
  let researchMode: boolean;
  let briefingMode: boolean;

  if (shopItem) {
    query = `${shopItem}を買い物リストに追加して`;
    researchMode = false;
    briefingMode = false;
  } else if (shopAction) {
    query = `買い物リストを${shopAction}`;
    researchMode = false;
    briefingMode = false;
  } else if (topicQuery) {
    query = topicQuery;
    researchMode = !isCommandQuery(topicQuery);
    briefingMode = false;
  } else {
    query = rawQuery;
    briefingMode = isBriefingQuery(rawQuery);
    researchMode = !briefingMode && isResearchQuery(rawQuery);
  }

  const isLaunchPhrase = !query || LAUNCH_PHRASES.includes(query.trim());
  return { query, researchMode, briefingMode, isLaunchPhrase };
}
