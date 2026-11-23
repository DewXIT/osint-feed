import { describe, expect, it, vi } from "vitest";
import { fetchHtml, parseHtml } from "../src/html.js";
import type { HarvesterWarning, HtmlSourceConfig } from "../src/types.js";

const source: HtmlSourceConfig = {
  id: "html-source",
  name: "HTML Source",
  type: "html",
  url: "https://example.com/news",
  tags: ["test"],
  selectors: {
    article: "article",
    title: "h2 a",
    link: "h2 a",
    date: "time",
    summary: "p.summary",
  },
};

const html = `
  <main>
    <article>
      <h2><a href="/story-1">  First   story  </a></h2>
      <time datetime="2026-03-25T12:00:00Z">March 25, 2026</time>
      <p class="summary">  Summary   one </p>
    </article>
    <article>
      <h2><a href="https://example.com/story-2">Second story</a></h2>
      <time>2026-03-24T10:30:00Z</time>
      <p class="summary">Summary two</p>
    </article>
  </main>
`;

describe("parseHtml", () => {
  it.each([
    "javascript:alert(1)",
    "JaVaScRiPt:alert(1)",
    " \tjavascript:alert(1)\n",
    "java&#x09;script:alert(1)",
    "&#106;avascript&#58;alert(1)",
    "javascript&colon;alert(1)",
    "data:text/html,unsafe",
    "vbscript:msgbox(1)",
    "file:///etc/passwd",
    "https://[invalid",
    "",
  ])("skips unsafe links decoded from HTML: %j", (href) => {
    const input = `<article><h2><a href="${href}">Unsafe</a></h2></article>${html}`;
    const articles = parseHtml(input, source, new Date(), 1);
    expect(articles).toHaveLength(1);
    expect(articles[0]!.url).toBe("https://example.com/story-1");
  });

  it("accepts HTTP links and decodes URL entities", () => {
    const articles = parseHtml(
      '<article><h2><a href="http://other.com/story?a=1&amp;b=2">HTTP</a></h2></article>',
      source,
    );
    expect(articles[0]!.url).toBe("http://other.com/story?a=1&b=2");
  });

  it("parses normalized article data", () => {
    const articles = parseHtml(html, source, new Date("2026-03-25T13:00:00Z"));

    expect(articles).toHaveLength(2);
    expect(articles[0]).toMatchObject({
      title: "First story",
      url: "https://example.com/story-1",
      summary: "Summary one",
      sourceId: "html-source",
    });
    expect(articles[0]!.publishedAt?.toISOString()).toBe("2026-03-25T12:00:00.000Z");
    expect(articles[1]!.publishedAt?.toISOString()).toBe("2026-03-24T10:30:00.000Z");
  });

  it("respects maxItems limit", () => {
    const articles = parseHtml(html, source, new Date("2026-03-25T13:00:00Z"), 1);
    expect(articles).toHaveLength(1);
    expect(articles[0]!.title).toBe("First story");
  });
});

describe("fetchHtml", () => {
  it("emits warnings for empty results and truncation", async () => {
    const warnings: HarvesterWarning[] = [];
    const fetchFn = vi.fn(async () => new Response(html, { status: 200 }));

    const articles = await fetchHtml(source, {
      fetchFn,
      maxItems: 1,
      onWarning: (warning) => warnings.push(warning),
    });

    expect(articles).toHaveLength(1);
    expect(warnings.some((warning) => warning.code === "truncated-source")).toBe(true);
    expect(fetchFn).toHaveBeenCalledOnce();
  });

  it("warns when selectors match nothing", async () => {
    const warnings: HarvesterWarning[] = [];

    await fetchHtml(
      { ...source, selectors: { ...source.selectors, article: ".missing" } },
      {
        fetchFn: async () => new Response(html, { status: 200 }),
        onWarning: (warning) => warnings.push(warning),
      },
    );

    expect(warnings).toContainEqual(
      expect.objectContaining({ code: "empty-html-result" }),
    );
  });
});
