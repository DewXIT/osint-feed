import { describe, expect, it } from "vitest";
import { enrichArticleText } from "../src/articleText.js";
import reviewedNoise from "./fixtures/2026-11-25-rejected-review.json";
import regionReview from "./fixtures/2026-11-25-region-review.json";
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
    ["de", "Bundestag berät über neue Gesetze", "Die Regierung in Deutschland will mehr Geld für die Bundeswehr, die Opposition kritisiert das.", "EU", "politics"],
    ["en", "Estonia investigates sabotage", "Officials in Tallinn said the investigation was continuing.", "BALTIC", "security"],
  ] as const)("classifies %s text", (lang, title, body, region, topic) => {
    const result = classifyArticle(title, body);
    expect(result).toMatchObject({ lang, topic, scope: "region" });
    expect(result.regions).toContain(region);
    expect(result.relevance).toBeGreaterThanOrEqual(0.65);
    expect(result.relevance).toBeLessThanOrEqual(1);
  });

  it.each([
    "Russian strikes kill five in Kharkiv", "Russia strikes Zelenskyy's hometown, killing 2",
    "Russian strike hits football stadium in Ukraine", "Shelling reported in Kherson", "Missile attack on Kyiv", "Drone attack on Odesa",
    "Ostrzał Charkowa", "Atak na Kijów", "Uderzenie na Charków", "Ukraine launches offensive",
    "Troops killed on the eastern front in Ukraine", "Ракетный удар по Харькову",
    "Атака на Киев", "Обстріл Харкова", "Удар по Україні", "Атака на Київ",
    "MON ogłasza decyzję w Warszawie",
    "Premiera robota PIAP HUNTeR 2. Agencja Uzbrojenia uruchomiła opcję na Tarantule w Polsce",
  ])("keeps regional military coverage: %s", (title) => {
    const result = classifyArticle(title, "");
    expect(result).toMatchObject({ topic: "military", scope: "region" });
    expect(result.relevance).toBeGreaterThanOrEqual(0.65);
  });

  it.each([
    ...reviewedNoise,
    ...["Premier League: Arsenal beat Chelsea", "London football league president resigns",
      "Liga w Warszawie: premier na trybunach", "Think tank report on housing costs",
      "Social Security payments rise", "Президент поїхав за кордон", "Mon 24 Nov: weather update for Gdansk",
    ].map((title) => ({ title, summary: "" })),
  ])("rejects reviewed noise: $title", ({ title, summary }) => {
    expect(classifyArticle(title, summary).relevance).toBeLessThan(0.65);
  });

  it.each(["криминал", "кримінальна справа"])("avoids a false Crimea match: %s", (title) => {
    expect(classifyArticle(title, "").regions).not.toContain("UA");
  });

  it.each([
    ["Hundreds of schools in Germany and Denmark receive bomb threats", "security", "EU"],
    ["Russia charges Moscow military gear retailer with ‘financing extremist activity’", "security", "RU"],
    ["DR Congo says military aircraft missing as rebels claim to shoot down plane", "military", "OTHER"],
    ["Poland deepens regional gas cooperation with Hungary", "security", "PL"],
  ])("keeps the reviewed story on topic: %s", (title, topic, region) => {
    const article = classifyArticle(title, "");
    expect(article.topic).toBe(topic);
    expect(article.regions).toContain(region);
    expect(article.relevance).toBeGreaterThanOrEqual(0.65);
  });

  it("distinguishes a repeated weak word from independent or strong world evidence", () => {
    expect(classifyArticle("Japan reviews military plans", "Military plans clarified.").relevance).toBeLessThan(0.65);
    expect(classifyArticle("Drone photos from Japan", "Drones on display").relevance).toBeLessThan(0.65);
    for (const [title, body] of [
      ["Japan reviews military plans", "The navy confirmed."],
      ["Shelling in Sudan", ""], ["Think tank reports missile attack", ""],
    ] as const) expect(classifyArticle(title, body).relevance).toBeGreaterThanOrEqual(0.65);
  });

  it.each([
    "Норвегія замовляє нові ракети", "Военные учения в Польше", "Nowe pociski dla Norwegii",
    "First Flight of New Royal Air Force H-47ER Special Ops Chinook",
    "Chief of Defence Intelligence speech at Cambridge Intelligence Seminar: 20 November 2026",
    ...("UK|Norway|Portugal|Bulgaria|Croatia|Poland|Estonia|Albania|Austria|Belgium|Cyprus|Czechia|Denmark|Finland|France|Germany|Greece|Hungary|Iceland|Ireland|Italy|Latvia|Lithuania|Luxembourg|Malta|Montenegro|Netherlands|North Macedonia|Romania|Slovakia|Slovenia|Spain|Sweden|Türkiye").split("|").map((country) => country + " defence budget"),
  ])("recognizes European and allied coverage: %s", (title) => {
    const article = classifyArticle(title, "");
    expect(article.regions).toContain("EU");
    expect(article.scope).toBe("region");
  });

  it.each(regionReview)("takes regions from the story, not from the US or a media brand: $title", ({ title, summary }) => {
    const article = classifyArticle(title, summary ?? "");
    expect(article.regions).toEqual(["OTHER"]);
    expect(article.scope).toBe("world");
  });

  it.each(["Canada", "United States", "US", "U.S.", "American"])("keeps %s outside the regional scope", (country) => {
    expect(classifyArticle(country + " defence budget", "").regions).toEqual(["OTHER"]);
  });

  it("ranks routine US aviation below world violence and never as EU", () => {
    const routine = regionReview.filter(({ title }) => /MV-75|F-35A|B-52/u.test(title))
      .map(({ title, summary }) => classifyArticle(title, summary ?? ""));
    expect(routine).toHaveLength(3);
    const strike = classifyArticle("Israeli air strike kills four people in Gaza", "");
    for (const article of routine) {
      expect(article).toMatchObject({ regions: ["OTHER"], scope: "world" });
      expect(article.relevance).toBeLessThan(strike.relevance);
    }
  });

  it.each([
    ["Piorun 2 coraz bliżej. Prezes PGZ wskazuje datę [KOMENTARZ]", "Prezes Polskiej Grupy Zbrojeniowej przekazał, kiedy w ofercie znajdzie się system przeciwlotniczy Piorun 2."],
    ["Kosiniak-Kamysz podpisał kontrakt na kolejne K2", ""],
    ["Homar-K: kolejne wyrzutnie trafią do jednostek", ""],
    ["Borsuk wjeżdża do produkcji seryjnej", ""],
    ["WOT ćwiczą z sojusznikami", ""],
    ["Dowództwo Operacyjne poderwało myśliwce", "Dowództwo Operacyjne RSZ poinformowało o aktywności lotnictwa nad Polską."],
    ["Zbrojeniówka czeka na decyzję", "Polski przemysł obronny liczy na zamówienia."],
    ["Abrams i Apache: nowe umowy", "Agencja Uzbrojenia podpisała umowy dla wojska w Polsce."],
    ["Polish defence industry wins procurement deal", ""],
    ["Prezes spółki wskazuje datę", "Spółka z grupy PGZ dostarczy Pioruny."],
    ["Polscy saperzy zdemontują most w Słowenii", ""],
  ])("keeps Polish defence coverage: %s", (title, body) => {
    const article = classifyArticle(title, body);
    expect(article.regions).toContain("PL");
    expect(["military", "security"]).toContain(article.topic);
    expect(article.relevance).toBeGreaterThanOrEqual(0.65);
  });

  it.each([
    ["Clashing political visions reflect a divided Spain ahead of election", "Sunday’s election could see a far-right party enter the Spanish government for first time."],
    ["French ex-President Sarkozy and wife Carla Bruni to face trial", "It is the latest case involving Nicolas Sarkozy who became the first French ex-president to go to jail last year."],
    ["Latvia's new coalition off to a slow start", "The new government in Latvia has yet to agree on its priorities."],
    ["Domestic violence soars to record high in Germany", "Every three days in Germany, a man kills his wife or ex-partner."],
    ["Founders of Russian pet store chain killed in Chile after tourist minibus collides with truck", ""],
    ["A Look At The Dam Busters And Their Incredible Bouncing Bombs", "Barnes Wallis’s design offered the RAF a weapon to destroy German dams."],
    ["Bomb squad prepares to destroy 250-kg WWII German explosive found in Pärnu County", "Estonian Defense Forces' training area."],
    ["European Defence Standardisation - Call for experts 2027", ""],
  ])("drops domestic politics and incidental keywords: %s", (title, body) => {
    expect(classifyArticle(title, body).relevance).toBeLessThan(0.65);
  });

  it("keeps diplomacy with a party to the war", () => {
    const body = "Hungary's new prime minister met President Zelenskyy in Kyiv.";
    expect(classifyArticle("Ukraine: Zelenskyy and Hungary's Magyar meet amid thaw in ties", body))
      .toMatchObject({ topic: "politics", regions: expect.arrayContaining(["UA", "EU"]) });
    expect(classifyArticle("Ukraine: Zelenskyy and Hungary's Magyar meet amid thaw in ties", body).relevance).toBeGreaterThanOrEqual(0.65);
    expect(classifyArticle("Latvian president meets Estonian prime minister", "").relevance).toBeLessThan(0.65);
  });

  it("removes Notes from Poland fundraising sentences and falls back to the description", () => {
    const banner = "Keep our news free from paywalls by making a donation to support our work! " +
      "Notes from Poland is run by a small editorial team and is published by an independent, non-profit foundation that is funded through donations from our readers. " +
      "We cannot do what we do without your support.";
    const news = "Poland signed a defence agreement.";
    const extract = (body: string, description: string | null) =>
      enrichArticleText("Defence agreement", body, description, "Notes from Poland").summary;
    expect(extract(banner + " " + news, null)).toBe(news);
    expect(extract(banner, news)).toBe(news);
    expect(extract("<p>Support our independent journalism today.</p><p>" + news + "</p>", null)).toBe(news);
    expect(extract(banner, null)).toBeNull();
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
      { scope: "world", regions: ["OTHER"], topic: "military", relevance: 0.72 },
      { scope: "world", regions: ["OTHER"], topic: "security", relevance: 0.72 },
    ]);
    expect(await run(0)).toHaveLength(2);
    expect(await run(0.72)).toHaveLength(2);
    expect(await run(0.73)).toHaveLength(0);
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
