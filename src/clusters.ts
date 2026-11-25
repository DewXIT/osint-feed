import type { Article } from "./types.js";

export const CLUSTER_WINDOW_MS = 24 * 60 * 60 * 1_000;
const TITLE_SIMILARITY = 0.6;
const MIN_TITLE_SIMILARITY_WITH_SUMMARY = 0.34;
const CORROBORATING_SIMILARITY = 0.28;

type ClusterArticle = Pick<Article, "title" | "hash" | "sourceId" | "publishedAt" | "fetchedAt" | "clusterId">
  & Partial<Pick<Article, "summary">>;
const eventTime = (article: ClusterArticle): number =>
  (article.publishedAt ?? article.fetchedAt).getTime();

const STOP_WORDS = new Set((
  "a an the and of in on at to for from with is are was were has have its as by after before amid says said reportedly media " +
  "i oraz ze sie jest sa dla przez na po wedlug der die das den dem und mit von ist les des une aux dans avec " +
  "и что это для был были после по на из і та що це був були після до від"
).split(" "));

const NORMALIZED_WORDS = new Map(Object.entries({
  attacked: "attack", attacks: "attack", attacking: "attack",
  drones: "drone",
  refineries: "refinery",
  russian: "russia", ukrainian: "ukraine",
  defences: "defence", defenses: "defence", defense: "defence",
  strikes: "strike", struck: "strike",
  warns: "warn", warned: "warn", warning: "warn",
  zero: "0", one: "1", two: "2", three: "3", four: "4", five: "5",
}));

const terms = (text: string): Set<string> => {
  const normalized = text.toLowerCase().normalize("NFKD").replace(/(\p{Script=Latin})\p{M}+/gu, "$1").normalize("NFC")
    .replace(/ł/gu, "l").replace(/(?<=\p{L})['’]s\b/gu, "");
  const words = normalized.match(/[\p{L}\p{N}]+/gu) ?? [];
  return new Set(words.filter((word) => !STOP_WORDS.has(word) && (word.length > 1 || /^\d$/u.test(word)))
    .map((word) => NORMALIZED_WORDS.get(word) ?? word));
};

const sharedTerms = (left: ReadonlySet<string>, right: ReadonlySet<string>): string[] =>
  [...left].filter((term) => right.has(term));

const similarity = (left: ReadonlySet<string>, right: ReadonlySet<string>, shared: number): number =>
  shared / (left.size + right.size - shared || 1);

const describe = (article: ClusterArticle) => {
  const title = terms(article.title);
  const summary = terms(article.summary ?? "");
  const numbers = new Set([...title].filter((term) => /^\d+$/u.test(term)));
  return { article, title, summary, numbers };
};

type DescribedArticle = ReturnType<typeof describe>;

const matchScore = (left: DescribedArticle, right: DescribedArticle): number => {
  const shared = sharedTerms(left.title, right.title);
  const sharedWords = shared.filter((term) => !left.numbers.has(term)).length;
  if (sharedWords < 3) return 0;

  const sharedNumbers = sharedTerms(left.numbers, right.numbers).length;
  if (sharedNumbers < Math.min(left.numbers.size, right.numbers.size)) return 0;

  const titleScore = similarity(left.title, right.title, shared.length);
  // A one-word substitution in otherwise equal headlines can name a different site or actor.
  const substitution = left.title.size === shared.length + 1 && right.title.size === shared.length + 1;
  if (substitution) {
    const leftDifference = [...left.title].find((term) => !right.title.has(term))!;
    const rightDifference = [...right.title].find((term) => !left.title.has(term))!;
    if (!left.summary.has(rightDifference) || !right.summary.has(leftDifference)) return 0;
  }
  if (titleScore >= TITLE_SIMILARITY) return titleScore;
  if (titleScore < MIN_TITLE_SIMILARITY_WITH_SUMMARY || sharedWords < 4) return 0;

  const leftSummaryScore = similarity(left.summary, right.title, sharedTerms(left.summary, right.title).length);
  const rightSummaryScore = similarity(right.summary, left.title, sharedTerms(right.summary, left.title).length);
  const summaryScore = similarity(left.summary, right.summary, sharedTerms(left.summary, right.summary).length);
  const corroboration = Math.max(leftSummaryScore, rightSummaryScore, summaryScore);

  return corroboration >= CORROBORATING_SIMILARITY ? (titleScore + corroboration) / 2 : 0;
};

/** Group cross-source headlines within 24 hours of the group's earliest article. */
export const clusterArticles = (
  articles: readonly Article[],
  previous: readonly ClusterArticle[] = [],
): Article[] => {
  const ordered = [...articles].sort((a, b) => eventTime(a) - eventTime(b) || a.hash.localeCompare(b.hash));
  const assigned = new Map<string, string>();
  const groups = new Map<string, DescribedArticle[]>();
  for (const article of previous) {
    const id = article.clusterId ?? article.hash;
    const members = groups.get(id) ?? [];
    members.push(describe(article));
    groups.set(id, members);
    assigned.set(article.hash, id);
  }

  for (const article of ordered) {
    if (assigned.has(article.hash)) continue;
    const candidate = describe(article);
    let bestId = article.hash;
    let bestScore = 0;
    const time = eventTime(article);
    for (const [id, members] of groups) {
      if (members.some(({ article: member }) => Math.abs(time - eventTime(member)) > CLUSTER_WINDOW_MS)) continue;
      const scores = members.map((member) => matchScore(candidate, member));
      if (scores.includes(0) || members.every(({ article: member }) => article.sourceId === member.sourceId)) continue;
      const score = Math.min(...scores);
      if (score > bestScore || (score === bestScore && id < bestId)) {
        bestId = id;
        bestScore = score;
      }
    }
    const members = groups.get(bestId) ?? [];
    members.push(candidate);
    groups.set(bestId, members);
    assigned.set(article.hash, bestId);
  }
  return articles.map((article) => ({ ...article, clusterId: assigned.get(article.hash) ?? article.hash }));
};
