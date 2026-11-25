import type { Article } from "./types.js";
import { jaccardSimilarity } from "./utils.js";

export const CLUSTER_WINDOW_MS = 24 * 60 * 60 * 1_000;
const SIMILARITY_THRESHOLD = 0.6;

type ClusterArticle = Pick<Article, "title" | "hash" | "sourceId" | "publishedAt" | "fetchedAt" | "clusterId">;
const eventTime = (article: ClusterArticle): number =>
  (article.publishedAt ?? article.fetchedAt).getTime();

const hasEnoughTitle = (title: string): boolean =>
  (title.match(/[\p{L}\p{N}]{2,}/gu)?.length ?? 0) >= 3;

/** Group cross-source headlines within 24 hours of the group's earliest article. */
export const clusterArticles = (
  articles: readonly Article[],
  previous: readonly ClusterArticle[] = [],
): Article[] => {
  const ordered = [...articles].sort((a, b) => eventTime(a) - eventTime(b) || a.hash.localeCompare(b.hash));
  const assigned = new Map<string, string>();
  const groups = new Map<string, ClusterArticle[]>();
  for (const article of previous) {
    const id = article.clusterId ?? article.hash;
    const members = groups.get(id) ?? [];
    members.push(article);
    groups.set(id, members);
    assigned.set(article.hash, id);
  }

  for (const article of ordered) {
    if (assigned.has(article.hash) || !hasEnoughTitle(article.title)) continue;
    let bestId = article.hash;
    let bestScore = 0;
    const time = eventTime(article);
    for (const [id, members] of groups) {
      if (members.some((member) => Math.abs(time - eventTime(member)) > CLUSTER_WINDOW_MS)) continue;
      for (const member of members) {
        if (article.sourceId === member.sourceId || !hasEnoughTitle(member.title)) continue;
        const score = jaccardSimilarity(article.title, member.title);
        if (score >= SIMILARITY_THRESHOLD && (score > bestScore || (score === bestScore && id < bestId))) {
          bestId = id;
          bestScore = score;
        }
      }
    }
    const members = groups.get(bestId) ?? [];
    members.push(article);
    groups.set(bestId, members);
    assigned.set(article.hash, bestId);
  }
  return articles.map((article) => ({ ...article, clusterId: assigned.get(article.hash) ?? article.hash }));
};
