import { LANGUAGE_WORDS, REGION_WORDS, TOPIC_WORDS } from "./keywords.js";
import type { Article, ArticleLanguage, ArticleTopic } from "./types.js";

const words = (text: string): string[] =>
  text.normalize("NFKC").toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];

const LATIN_LANGUAGES: readonly ArticleLanguage[] = ["en", "pl", "de", "fr", "es"];
const CYRILLIC_LANGUAGES: readonly ArticleLanguage[] = ["ru", "uk", "be"];
const DISTINCT_LETTERS: Partial<Record<ArticleLanguage, RegExp>> = {
  pl: /[ąćęłńóśźż]/giu,
  de: /[äöüß]/giu,
  uk: /[іїєґ]/giu,
  ru: /[ыэёъ]/giu,
  be: /[ў]/giu,
};

export const detectLanguage = (text: string): ArticleLanguage | null => {
  const latin = text.match(/\p{Script=Latin}/gu)?.length ?? 0;
  const cyrillic = text.match(/\p{Script=Cyrillic}/gu)?.length ?? 0;
  const letters = text.match(/\p{L}/gu)?.length ?? 0;
  if (letters === 0 || Math.max(latin, cyrillic) <= letters / 2) return null;

  const tokens = new Set(words(text));
  const candidates = cyrillic > latin ? CYRILLIC_LANGUAGES : LATIN_LANGUAGES;
  const ranked = candidates.map((lang) => {
    const pattern = DISTINCT_LETTERS[lang];
    const distinctive = pattern ? text.match(pattern)?.length ?? 0 : 0;
    const functional = LANGUAGE_WORDS[lang].split(" ").filter((word) => tokens.has(word)).length;
    return { lang, score: functional + Math.min(3, distinctive) * 2 };
  }).sort((a, b) => b.score - a.score);
  const [first, second] = ranked;
  return first && first.score > (second?.score ?? 0) ? first.lang : null;
};

type KeywordIndex<Key extends string> = ReadonlyMap<string, readonly {
  readonly key: Key;
  readonly phrase: readonly string[];
  readonly prefix: boolean;
}[]>;

const buildIndex = <Key extends string>(dictionary: Record<Key, readonly string[]>): KeywordIndex<Key> => {
  const index = new Map<string, { key: Key; phrase: string[]; prefix: boolean }[]>();
  for (const key of Object.keys(dictionary) as Key[]) {
    for (const keyword of dictionary[key]) {
      const phrase = words(keyword);
      const first = phrase[0];
      if (!first) continue;
      const prefix = keyword.endsWith("*");
      // Prefixes of single-word entries share a three-letter bucket.
      const bucket = prefix && phrase.length === 1 ? first.slice(0, 3) : " " + first;
      const entries = index.get(bucket) ?? [];
      entries.push({ key, phrase, prefix });
      index.set(bucket, entries);
    }
  }
  return index;
};

const regionIndex = buildIndex(REGION_WORDS);
const topicIndex = buildIndex(TOPIC_WORDS);

const scoreMatches = <Key extends string>(
  tokens: readonly string[],
  index: KeywordIndex<Key>,
): Map<Key, number> => {
  const matches = new Map<Key, Set<string>>();
  tokens.forEach((word, offset) => {
    const entries = [...(index.get(" " + word) ?? []), ...(index.get(word.slice(0, 3)) ?? [])];
    for (const { key, phrase, prefix } of entries) {
      if (!phrase.every((part, i) => {
        const token = tokens[offset + i];
        return prefix && i === phrase.length - 1 ? token?.startsWith(part) : token === part;
      })) continue;
      const evidence = matches.get(key) ?? new Set<string>();
      // Count an occurrence once even when several overlapping terms match.
      evidence.add(word);
      matches.set(key, evidence);
    }
  });
  return new Map([...matches].map(([key, evidence]) => [key, evidence.size]));
};

const scoreEvidence = (title: number, body: number): number =>
  title > 0 ? 38 + Math.min(title - 1, 2) * 3 : body > 0 ? 30 + Math.min(body - 1, 3) * 3 : 0;

export const classifyArticle = (
  title: string,
  body: string,
): Pick<Article, "lang" | "regions" | "scope" | "topic" | "relevance"> => {
  const lead = body.slice(0, 2_000);
  const titleTokens = words(title);
  const bodyTokens = words(lead);
  const titleRegions = scoreMatches(titleTokens, regionIndex);
  const bodyRegions = scoreMatches(bodyTokens, regionIndex);
  const matchedRegions = [...new Set([...titleRegions.keys(), ...bodyRegions.keys()])];
  const regionScore = Math.max(0, ...matchedRegions
    .map((region) => scoreEvidence(titleRegions.get(region) ?? 0, bodyRegions.get(region) ?? 0)));

  const titleTopics = scoreMatches(titleTokens, topicIndex);
  const bodyTopics = scoreMatches(bodyTokens, topicIndex);
  let topic: ArticleTopic = "other";
  let topicScore = 0;
  for (const candidate of ["military", "security", "politics"] as const) {
    const score = scoreEvidence(titleTopics.get(candidate) ?? 0, bodyTopics.get(candidate) ?? 0);
    if (score > topicScore) {
      topic = candidate;
      topicScore = score;
    }
  }
  const scope = matchedRegions.length > 0 ? "region" : "world";
  // World military and security stories use thematic evidence in place of regional evidence.
  // A headline match scores 0.67, while a body-only match needs several distinct signals to reach 0.65.
  const relevance = scope === "world" && (topic === "military" || topic === "security")
    ? Math.round(topicScore * 1.75) / 100
    : (regionScore + topicScore) / 100;
  return {
    lang: detectLanguage(title + " " + lead),
    regions: matchedRegions.length ? matchedRegions : ["OTHER"],
    topic,
    scope,
    relevance,
  };
};
