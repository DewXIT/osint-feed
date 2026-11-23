import { describe, expect, it, vi } from "vitest";
import { fetchRss } from "../src/rss.js";
import type { HarvesterWarning, RssSourceConfig } from "../src/types.js";

const source: RssSourceConfig = {
  id: "rss-source",
  name: "RSS Source",
  type: "rss",
  url: "https://example.com/feed.xml",
  tags: ["rss"],
};

const xml = `
  <rss version="2.0">
    <channel>
      <title>Feed</title>
      <item>
        <title>  First   item </title>
        <link>https://example.com/story-1</link>
        <pubDate>Tue, 25 Mar 2026 12:00:00 GMT</pubDate>
        <description>  Summary   one </description>
      </item>
      <item>
        <title>Second item</title>
        <link>https://example.com/story-2</link>
        <description>Summary two</description>
      </item>
    </channel>
  </rss>
`;

describe("fetchRss", () => {
  it.each(["javascript:alert(1)", "&#106;avascript&#58;alert(1)", "data:text/html,unsafe"])(
    "skips unsafe Atom link attributes: %s",
    async (href) => {
      const input = `<feed xmlns="http://www.w3.org/2005/Atom"><title>Feed</title>
        <entry><title>Unsafe</title><link href="${href}" /></entry>
        <entry><title>Safe</title><link href="/safe" /></entry>
      </feed>`;
      const articles = await fetchRss(source, {
        fetchFn: async () => new Response(input),
      });
      expect(articles).toHaveLength(1);
      expect(articles[0]!.url).toBe("https://example.com/safe");
    },
  );

  it.each([
    "javascript:alert(1)",
    "JaVaScRiPt:alert(1)",
    " \tjavascript:alert(1)\n",
    "java&#x09;script:alert(1)",
    "&#106;avascript&#58;alert(1)",
    "data:text/html,unsafe",
    "vbscript:msgbox(1)",
    "file:///etc/passwd",
    "https://[invalid",
    "",
  ])("skips unsafe links decoded from RSS: %j", async (href) => {
    const input = `<rss version="2.0"><channel><title>Feed</title>
      <item><title>Unsafe</title><link>${href}</link></item>
      <item><title>Safe</title><link>/safe</link></item>
    </channel></rss>`;
    const articles = await fetchRss(source, {
      fetchFn: async () => new Response(input),
      maxItems: 1,
    });
    expect(articles).toHaveLength(1);
    expect(articles[0]!.url).toBe("https://example.com/safe");
  });

  it.each(["http://other.com/story", "https://other.com/story"])(
    "accepts an absolute HTTP(S) article URL: %s",
    async (href) => {
      const input = xml.replace("https://example.com/story-1", href);
      const articles = await fetchRss(source, {
        fetchFn: async () => new Response(input),
        maxItems: 1,
      });
      expect(articles[0]!.url).toBe(href);
    },
  );

  it("parses feed items through injected fetch", async () => {
    const fetchFn = vi.fn(async () => new Response(xml, { status: 200 }));
    const articles = await fetchRss(source, { fetchFn });

    expect(fetchFn).toHaveBeenCalledOnce();
    expect(articles).toHaveLength(2);
    expect(articles[0]).toMatchObject({
      title: "First item",
      summary: "Summary one",
      url: "https://example.com/story-1",
    });
    expect(articles[0]!.publishedAt?.toISOString()).toBe("2026-03-25T12:00:00.000Z");
  });

  it("emits warnings for missing dates and truncation", async () => {
    const warnings: HarvesterWarning[] = [];

    const articles = await fetchRss(source, {
      fetchFn: async () => new Response(xml, { status: 200 }),
      maxItems: 1,
      onWarning: (warning) => warnings.push(warning),
    });

    expect(articles).toHaveLength(1);
    expect(warnings.some((warning) => warning.code === "truncated-source")).toBe(true);
  });

  it("throws on http errors", async () => {
    await expect(fetchRss(source, {
      fetchFn: async () => new Response("", { status: 503 }),
    })).rejects.toThrow("RSS fetch failed for rss-source: HTTP 503");
  });
});
