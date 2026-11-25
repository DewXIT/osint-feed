import * as cheerio from "cheerio";
import { classifyArticle } from "./classification.js";
import type { Article } from "./types.js";
import { normalizeText } from "./utils.js";

const MAX_SUMMARY_LENGTH = 400;
const BOILERPLATE = /^(?:read more|related (?:articles|stories)|also read|continue reading|subscribe|czytaj (?:więcej|także|również)|zobacz także|weiterlesen|mehr dazu|читать далее|читайте также|читати далі|читайте також)(?:$|[.!…:\s])/iu;
const TRAILING_BOILERPLATE = /\s+(?:Read more|Continue reading|Czytaj więcej|Weiterlesen|Читать далее|Читати далі)(?:\s*(?:[.:…»→]|$))/iu;
const SENTENCES = new Intl.Segmenter(undefined, { granularity: "sentence" });
const BREAKS = /<\/(?:p|div|li|h[1-6])\s*>|<br\s*\/?>/gi;

const plainText = (input: string): string => {
  if (!/<[a-z!/]|&(?:#\w+|\w+);/i.test(input)) return input;
  const $ = cheerio.load(input.replace(BREAKS, "$&\n"), {}, false);
  $("script, style, template, noscript").remove();
  return $.root().text();
};

const articleBody = (raw: string, sourceName: string): string => {
  const label = (text: string) => text.trim().replace(/[.\u2026:]+$/u, "").toLowerCase();
  const source = label(sourceName);
  return plainText(raw).split(/\r?\n/u).map(normalizeText).map((line) => {
    const sourcePrefix = line.match(/^(.+?)\s*[:|–—]\s+/u);
    return sourcePrefix && label(sourcePrefix[1]!) === source ? line.slice(sourcePrefix[0].length) : line;
  }).filter((line) => line && label(line) !== source && !BOILERPLATE.test(line))
    .join(" ").split(TRAILING_BOILERPLATE, 1)[0] ?? "";
};

const summarize = (body: string, sourceName: string): string | null => {
  const selected: string[] = [];
  let length = 0;
  for (const { segment } of SENTENCES.segment(body)) {
    const sentence = segment.trim();
    if (BOILERPLATE.test(sentence) || sentence.replace(/[.!…:]+$/u, "").toLowerCase() === sourceName.toLowerCase()) {
      continue;
    }
    if (length + sentence.length + selected.length > MAX_SUMMARY_LENGTH) {
      if (selected.length > 0) break;
      const head = sentence.slice(0, MAX_SUMMARY_LENGTH - 1).replace(/[\uD800-\uDBFF]$/u, "");
      const boundary = head.lastIndexOf(" ");
      return (boundary > 0 ? head.slice(0, boundary) : head) + "…";
    }
    selected.push(sentence);
    length += sentence.length;
    if (selected.length === 3) break;
  }
  return selected.join(" ") || null;
};

export const enrichArticleText = (
  title: string,
  content: string | null,
  description: string | null,
  sourceName: string,
): Pick<Article, "lang" | "regions" | "topic" | "relevance" | "summary"> => {
  const body = articleBody(content ?? "", sourceName) || articleBody(description ?? "", sourceName);
  return { ...classifyArticle(title, body), summary: summarize(body, sourceName) };
};
