import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { clusterArticles } from "../src/clusters.js";
import type { Article } from "../src/types.js";

type Sample = Pick<Article, "title" | "sourceId" | "summary">;
const fixture = new URL("./fixtures/2026-11-25-dry-run-clusters.json", import.meta.url);
const sample = JSON.parse(readFileSync(fixture, "utf8")) as Record<string, Sample>;
const date = new Date("2026-11-25T08:14:04Z");

const article = (hash: string, input: Sample): Article => ({
  ...input,
  hash,
  url: "https://example.com/" + hash,
  content: null,
  publishedAt: date,
  fetchedAt: date,
  tags: [],
  lang: "en",
  regions: ["RU"],
  scope: "region",
  topic: "security",
  relevance: 0.76,
  clusterId: null,
});

describe("clustering articles from the 25 November dry-run sample", () => {
  it("matches the UK sabotage warning across Al Jazeera and Kyiv Independent", () => {
    const a = article("a", sample.ukAlJazeera!);
    const b = article("b", sample.ukKyivIndependent!);
    expect(clusterArticles([a, b]).map(({ clusterId }) => clusterId)).toEqual(["a", "a"]);
  });

  it("uses summaries to group three accounts of the Samara refinery strikes", () => {
    const ids = ["refineriesKyivIndependent", "refineriesUkrinform", "refineriesMeduza"];
    const articles = ids.map((id) => article(id, sample[id]!));
    expect(new Set(clusterArticles(articles).map(({ clusterId }) => clusterId)).size).toBe(1);
    expect(new Set(clusterArticles(articles.map((item) => ({ ...item, summary: null })))
      .map(({ clusterId }) => clusterId)).size).toBe(3);
  });

  it.each([
    ["refineriesKyivIndependent", "warshipBenghazi"],
    ["refineriesMeduza", "zhytomyr"],
    ["refineriesMeduza", "dronesOvernight"],
    ["estoniaRail", "estoniaLand"],
  ])("keeps %s separate from %s", (first, second) => {
    const articles = [article(first, sample[first]!), article(second, sample[second]!)];
    expect(clusterArticles(articles).map(({ clusterId }) => clusterId)).toEqual([first, second]);
  });

  it("normalizes diacritics while keeping conflicting locations and numbers separate", () => {
    const common = "Army deploys two brigades near";
    const summary = "The army deploys brigades near the city during exercises.";
    const articles = [
      article("a", { title: `${common} Kraków`, sourceId: "one", summary }),
      article("b", { title: `${common} Krakow`, sourceId: "two", summary }),
      article("c", { title: `${common} Warsaw`, sourceId: "three", summary }),
      article("d", { title: "Army deploys three brigades near Kraków", sourceId: "four", summary }),
    ];
    expect(clusterArticles(articles).map(({ clusterId }) => clusterId)).toEqual(["a", "a", "c", "d"]);
  });

  it("requires a new member to match each article in a cluster", () => {
    const base = "Army investigates airfield incident";
    const articles = [
      article("a", { title: `${base} in Taipei`, sourceId: "one", summary: null }),
      article("b", { title: base, sourceId: "two", summary: null }),
      article("c", { title: `${base} in Seoul`, sourceId: "three", summary: null }),
    ];
    expect(clusterArticles(articles).map(({ clusterId }) => clusterId)).toEqual(["a", "a", "c"]);
  });
});
