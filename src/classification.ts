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

// Regions come only from the article text. The upper-case Polish ministry acronym names Poland.
// Media brands such as "FRANCE 24's correspondent" are not places.
const regionTokens = (text: string): string[] => words(text
  .replace(/\b(?:France ?24|Deutsche Welle|Radio Free Europe(?:\/Radio Liberty)?|Euronews|Euractiv|Politico Europe|European Pravda)\b/giu, " ")
  .replace(/\bMON\b(?!\s+\d{1,2}\b)/gu, "ministerstwo obrony narodowej"));

// Diplomacy between a party to the war and another country is security policy.
const WAR_PARTIES: ReadonlySet<string> = new Set(["RU", "BY", "UA"]);

// Remove ambiguous phrases before counting topic evidence, keeping the surrounding story.
const topicTokens = (text: string): string[] => words(text
  .replace(/\bMON\b(?!\s+\d{1,2}\b)/gu, "ministerstwo obrony")
  .replace(/\b(?:think[ -]tanks?|social security|premier league|military gear (?:store|retailer)|second front)\b/giu, " ")
  .replace(/за кордон[\p{L}]*/giu, " "));

// Civilian subject matter can otherwise inherit an incidental political or military keyword.
const combatHeadline = /\b(?:air raids?|bomb(?:ed|ing)|(?:army|troops|forces|missiles?|drones?) (?:hit|attack|strike)|(?:russian|ukrainian) (?:attack|strike)s?)\b/iu;
const civilianHeadline = /\b(?:premier league|football|liga|wwii|ww2|world war (?:ii|two|2)|second world war|dam busters|call for (?:experts|proposals|applications)|collides?|collision|(?:car|road|traffic|bus|minibus) (?:crash|accident)|drug (?:lord|cartel)|tobacco|witness tampering|bank transfers|migrant workers|abortion|extradition|aerobatic|rehearsal ahead of (?:official )?unveiling|(?:union|workers).{0,60}strike)\b/iu;
const strongSignals = buildIndex({ strong: [
  "airstrike*", "air strike*", "shelling", "missile*", "drone attack*", "car bomb*", "armed forces", "army units",
  "air defence", "air defense", "sabotage", "espionage", "cyberattack*", "terroris*", "bomb threat*",
  "ostrzał*", "obrona powietrzna", "обстрел*", "обстріл*", "ракет*", "ракетний удар", "ракетный удар",
] });

const scoreMatches = <Key extends string>(
  tokens: readonly string[],
  index: KeywordIndex<Key>,
): Map<Key, Set<string>> => {
  const matches = new Map<Key, Set<string>>();
  tokens.forEach((word, offset) => {
    const entries = [...(index.get(" " + word) ?? []), ...(index.get(word.slice(0, 3)) ?? [])];
    const stems = new Map<Key, string>();
    for (const { key, phrase, prefix } of entries) {
      if (!phrase.every((part, i) => {
        const token = tokens[offset + i];
        return prefix && i === phrase.length - 1 ? token?.startsWith(part) : token === part;
      })) continue;
      // One token can match multiple languages or overlapping singular and prefix entries.
      const stem = phrase[0]!;
      if (stem.length < (stems.get(key)?.length ?? Infinity)) stems.set(key, stem);
    }
    for (const [key, stem] of stems) {
      const evidence = matches.get(key) ?? new Set<string>();
      evidence.add(stem.replace(/^(strike|tank)s$/u, "$1").replace(/^kill(?:s|ed|ing)$/u, "kill"));
      matches.set(key, evidence);
    }
  });
  return matches;
};

const scoreEvidence = (title: number, body: number): number =>
  title > 0 ? 38 + Math.min(title - 1, 2) * 3 : body > 0 ? 30 + Math.min(body - 1, 3) * 3 : 0;

export const classifyArticle = (
  title: string,
  body: string,
): Pick<Article, "lang" | "regions" | "scope" | "topic" | "relevance"> => {
  const lead = body.slice(0, 2_000);
  const titleTokens = regionTokens(title);
  const bodyTokens = regionTokens(lead);
  const titleRegions = scoreMatches(titleTokens, regionIndex);
  const bodyRegions = scoreMatches(bodyTokens, regionIndex);
  const matchedRegions = [...new Set([...titleRegions.keys(), ...bodyRegions.keys()])];
  if (matchedRegions.includes("PL") && !matchedRegions.includes("EU")) matchedRegions.push("EU");
  const regionScore = Math.max(0, ...matchedRegions
    .map((region) => scoreEvidence(titleRegions.get(region)?.size ?? 0, bodyRegions.get(region)?.size ?? 0)));

  const headline = topicTokens(title);
  const bodyWords = topicTokens(lead);
  const titleTopics = scoreMatches(headline, topicIndex);
  const bodyTopics = scoreMatches(bodyWords, topicIndex);
  let topic: ArticleTopic = "other";
  let topicScore = 0;
  for (const candidate of ["military", "security", "politics"] as const) {
    const score = scoreEvidence(titleTopics.get(candidate)?.size ?? 0, bodyTopics.get(candidate)?.size ?? 0);
    if (score > topicScore) {
      topic = candidate;
      topicScore = score;
    }
  }
  const scope = matchedRegions.length > 0 ? "region" : "world";
  const strongHeadline = scoreMatches(headline, strongSignals).size > 0;
  const ambiguousHeadline = /\b(?:think[ -]tank|social security)\b|за кордон/iu.test(title);
  const hasSecurityContext = titleTopics.has("military") || titleTopics.has("security") ||
    bodyTopics.has("military") || bodyTopics.has("security");
  if ((civilianHeadline.test(title) && !strongHeadline && !combatHeadline.test(title)) || (ambiguousHeadline && !hasSecurityContext)) {
    topic = "other";
    topicScore = 0;
  }
  let relevance = (regionScore + topicScore) / 100;
  const signals = new Set((["military", "security"] as const).flatMap((key) => [
    ...(titleTopics.get(key) ?? []),
    ...(bodyTopics.get(key) ?? []),
  ]));
  const strong = strongHeadline || scoreMatches(bodyWords, strongSignals).size > 0;
  const securityTopic = topic === "military" || topic === "security";
  if (scope === "world" && securityTopic) {
    // Routine world items stay near the world threshold; violence and hybrid threats rank first.
    const qualified = signals.size >= 2 || strong;
    relevance = qualified ? Math.round(topicScore * 1.75 + (strong ? 5 : 0)) / 100 : 0;
  } else if (scope === "region") {
    // Only security policy counts: no domestic politics or a lone incidental keyword in the body.
    // Polish defence coverage is the primary input, so body-only evidence is enough there.
    const polish = matchedRegions.includes("PL");
    // PL and Baltic words also imply EU, so EU counts as a separate party only without them.
    const countries = matchedRegions.filter((region) => region !== "EU");
    const otherEurope = matchedRegions.includes("EU") && !countries.some((region) => region === "PL" || region === "BALTIC");
    const warDiplomacy = countries.some((region) => WAR_PARTIES.has(region)) && countries.length + Number(otherEurope) >= 2;
    const headlineSecurity = titleTopics.has("military") || titleTopics.has("security");
    const qualified = securityTopic
      ? headlineSecurity || signals.size >= 2 || strong || polish || warDiplomacy
      : topic === "politics" && (hasSecurityContext || warDiplomacy);
    if (!qualified) relevance = Math.min(relevance, 0.6);
    else if (polish && securityTopic) relevance += 0.05;
  }
  relevance = Math.round(Math.min(1, relevance) * 100) / 100;
  return {
    lang: detectLanguage(title + " " + lead),
    regions: matchedRegions.length ? matchedRegions : ["OTHER"],
    topic,
    scope,
    relevance,
  };
};
