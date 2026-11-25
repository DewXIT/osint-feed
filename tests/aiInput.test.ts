import { describe, expect, it } from "vitest";
import { classifyArticle, detectLanguage } from "../src/classification.js";
import { clusterArticles } from "../src/clusters.js";
import { createHarvester } from "../src/harvester.js";
import type { Article, HarvesterWarning, RssSourceConfig } from "../src/types.js";

const source: RssSourceConfig = {
  id: "regional",
  type: "rss",
  name: "Regional News",
  url: "https://example.com/feed",
  tags: [],
};

const feed = (headline: string, description: string, url = "/article", published = "Wed, 25 Nov 2026 12:00:00 GMT") =>
  '<rss version="2.0"><channel><title>Regional News</title><item>' +
  "<title>" + headline + "</title><link>" + url + "</link><pubDate>" + published +
  "</pubDate><description><![CDATA[" + description + "]]></description></item></channel></rss>";

describe("article classification", () => {
  it.each([
    ["en", "Poland boosts air defence", "The Polish military has announced the decision.", "PL", "military"],
    ["pl", "Straż Graniczna na granicy z Białorusią", "Funkcjonariusze zatrzymali się po polskiej stronie.", "BY", "security"],
    ["ru", "Военные учения в Калининграде", "Власти заявили, что это было частью учений.", "RU", "military"],
    ["uk", "ЗСУ повідомили про нові події на Харківщині", "Про це йдеться у заяві України після засідання.", "UA", "military"],
    ["de", "Bundestag berät über neue Gesetze", "Die Regierung in Deutschland wurde von der Opposition kritisiert.", "EU", "politics"],
    ["en", "Estonia investigates sabotage", "Officials in Tallinn said the investigation was continuing.", "BALTIC", "security"],
  ] as const)("classifies %s text", (lang, title, body, region, topic) => {
    const result = classifyArticle(title, body);
    expect(result).toMatchObject({ lang, topic, scope: "region" });
    expect(result.regions).toContain(region);
    expect(result.relevance).toBeGreaterThanOrEqual(0.65);
    expect(result.relevance).toBeLessThanOrEqual(1);
  });

  it("weighs headline matches above the same words in the body", () => {
    const relevant = "Poland boosts its air defence";
    expect(classifyArticle(relevant, "").relevance).toBeGreaterThan(classifyArticle("Update", relevant).relevance);
    expect(classifyArticle("Nvidia launches a GPU", "The chip has a heat tankard.")).toMatchObject({
      regions: ["OTHER"], scope: "world", topic: "other", relevance: 0,
    });
    expect(detectLanguage("東京")).toBeNull();
  });
});

describe("harvester AI input", () => {
  it("retains the URL hash, extracts three clean sentences and keeps the original content", async () => {
    const description = "<p>Regional News</p><p>Poland has deployed air defences. The army confirmed the move. Training continues. This fourth sentence is omitted.</p><p>Read more »</p>";
    const harvester = createHarvester({
      sources: [source],
      fetch: async () => new Response(feed("Poland deploys air defences", description)),
    });
    const [article] = await harvester.fetchAll();
    expect(article).toMatchObject({
      title: "Poland deploys air defences",
      url: "https://example.com/article",
      hash: "632538290468e7a39c06323c9e3ae98f31072d641cbb37ea37917f56bbeb5539",
      content: description,
      summary: "Poland has deployed air defences. The army confirmed the move. Training continues.",
    });
  });

  it("caps a long first sentence and retains the article content", async () => {
    const body = ("Wojsko w Polsce sprawdza sprzęt i raportuje wyniki badań ").repeat(20).trim() + ".";
    const harvester = createHarvester({
      sources: [source],
      fetch: async () => new Response(feed("Wojsko Polskie prowadzi ćwiczenia", body)),
    });
    const [article] = await harvester.fetchAll();
    expect(article?.summary?.length).toBeLessThanOrEqual(400);
    expect(article?.summary).toMatch(/…$/u);
    expect(article?.summary).not.toBe(article?.content);
    expect(article?.content).toBe(body);
  });

  it("filters on the global threshold or the source override and emits rejection counts", async () => {
    const warnings: HarvesterWarning[] = [];
    const harvester = createHarvester({
      sources: [source, { ...source, id: "permissive", minRelevance: 0 }],
      minRelevance: 0.65,
      requestGap: 0,
      onWarning: (warning) => warnings.push(warning),
      fetch: async () => new Response(feed("Nvidia has launched its new GPU", "This announcement was made today.")),
    });
    expect((await harvester.fetchAll()).map((article) => article.sourceId)).toEqual(["permissive"]);
    expect(warnings).toContainEqual(expect.objectContaining({
      code: "below-min-relevance", details: { rejected: 1, minRelevance: 0.65 },
    }));
    expect(() => createHarvester({ sources: [source], minRelevance: 1.1 })).toThrow(RangeError);
  });

  it("applies world topic and score rules independently of a regional source override", async () => {
    const headlines = ["Japan deploys army units", "Japan investigates sabotage", "Japan calls elections", "Tokyo has a new tram"];
    const run = (minRelevance?: number) => createHarvester({
      sources: headlines.map((_, i) => ({ ...source, id: String(i), url: source.url + "/" + i, minRelevance: 0.71 })),
      minRelevance: 0.65,
      world: minRelevance === undefined ? {} : { minRelevance },
      requestGap: 0,
      fetch: async (input) => {
        const i = Number(String(input).at(-1));
        return new Response(feed(headlines[i]!, "", "/article/" + i));
      },
    }).fetchAll();
    expect(await run()).toMatchObject([
      { scope: "world", regions: ["OTHER"], topic: "military", relevance: 0.67 },
      { scope: "world", regions: ["OTHER"], topic: "security", relevance: 0.67 },
    ]);
    expect(await run(0)).toHaveLength(2);
    expect(await run(0.67)).toHaveLength(2);
    expect(await run(0.68)).toHaveLength(0);
  });

  it("groups similar titles from different sources across midnight without grouping older coverage", async () => {
    const harvester = createHarvester({
      sources: [source, ...["other", "same-yesterday"].map((id) => ({
        ...source, id, url: "https://example.com/" + id,
      }))],
      requestGap: 0,
      fetch: async (input) => {
        const id = new URL(String(input)).pathname;
        const earlier = id === "/same-yesterday";
        const date = earlier ? "Mon, 23 Nov 2026 10:00:00 GMT"
          : id === "/other" ? "Thu, 26 Nov 2026 00:30:00 GMT" : "Wed, 25 Nov 2026 12:00:00 GMT";
        return new Response(feed(
          id === "/other" ? "Poland deploys new air defence systems" : "Poland deploys air defence systems",
          "Poland sent army units.",
          id + "/article",
          date,
        ));
      },
    });
    const [one, two, old] = await harvester.fetchAll() as [Article, Article, Article];
    expect(one.clusterId).toBe(two.clusterId);
    expect(old.clusterId).not.toBe(one.clusterId);
    expect(clusterArticles([two], [one])[0]?.clusterId).toBe(one.clusterId);
    expect(clusterArticles([{ ...two, sourceId: one.sourceId }], [one])[0]?.clusterId).toBe(two.hash);
  });
});
