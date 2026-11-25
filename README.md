# osint-feed

Config-driven news harvester for Node.js. Pulls articles from RSS feeds and HTML pages, deduplicates them, and produces a compact digest ready to feed into an LLM context window.

No AI inside. No opinions about your stack. Just articles in, structured data out.

Use RSS when you have it, or HTML selectors for sites without feeds. Version 0.2.0 adds offline language detection, regional and topical classification, short extractive summaries, and cross-source event clusters.

## Why

You're building something that needs fresh news context — a SITREP generator, a threat monitor, a research assistant. You have 30+ sources across languages and formats. You need the data compact enough to fit in a Llama/GPT context window without blowing the budget.

Existing tools are either Python-only (newspaper4k), heavy self-hosted platforms (Huginn), or commercial APIs (Newscatcher, NewsAPI). Nothing in the JS/TS ecosystem does config-driven multi-source harvesting with built-in LLM-ready compression.

`osint-feed` fills that gap.

## Install

```bash
npm install osint-feed
```

Requires Node.js 18+.

## Quick Start

```typescript
import { createHarvester } from "osint-feed";

const harvester = createHarvester({
  sources: [
    {
      id: "bbc-world",
      name: "BBC World",
      type: "rss",
      url: "https://feeds.bbci.co.uk/news/world/rss.xml",
      tags: ["global", "uk"],
      interval: 15,
    },
    {
      id: "nato",
      name: "NATO Newsroom",
      type: "html",
      url: "https://www.nato.int/cps/en/natohq/news.htm",
      tags: ["nato"],
      interval: 30,
      selectors: {
        article: ".event-list-item",
        title: "a span:first-child",
        link: "a",
        date: ".event-date",
      },
    },
  ],
});

// Fetch everything
const articles = await harvester.fetchAll();

// Or get an LLM-ready digest
const { articles: digest, stats } = await harvester.digest();
console.log(`${stats.totalFetched} articles -> ${stats.afterDedup} unique -> ${stats.estimatedTokens} tokens`);
```

## Source Types

### RSS / Atom

Works out of the box. No selectors needed — feeds are parsed automatically.

```typescript
{
  id: "france24",
  name: "France24",
  type: "rss",
  url: "https://www.france24.com/en/rss",
  tags: ["global", "europe"],
  interval: 15,
}
```

### HTML Scraping

You define CSS selectors per source. The library uses [cheerio](https://github.com/cheeriojs/cheerio) — no headless browser, no Puppeteer overhead.

This is still config-driven scraping: the library does not auto-discover article lists or infer what is relevant to your use case.

```typescript
{
  id: "defence24",
  name: "Defence24",
  type: "html",
  url: "https://defence24.pl/",
  tags: ["poland", "defence"],
  interval: 15,
  selectors: {
    article: "article",        // repeating container
    title: "h2 a",             // title text (within article)
    link: "h2 a",              // link href (within article)
    date: "time",              // optional: publication date
    summary: ".lead",          // optional: description text
  },
}
```

## API

### `createHarvester(options)`

Creates a harvester instance. Options:

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `sources` | `SourceConfig[]` | required | Array of source definitions |
| `dedup.known` | `() => string[]` | — | Returns hashes already in your DB (for cross-session dedup) |
| `digest` | `DigestOptions` | see below | Default digest settings |
| `requestTimeout` | `number` | `15000` | HTTP timeout in ms |
| `requestGap` | `number` | `1000` | Minimum ms between requests (rate limiting) |
| `maxItemsPerSource` | `number` | `50` | Cap articles returned from one source |
| `minRelevance` | `number` | `0` | Reject articles below a score from 0 to 1. A source can override this setting with its own `minRelevance`. |
| `world` | `{ minRelevance?: number }` | — | Enable the AI-input policy for articles outside target regions. Only `military` and `security` qualify. The world threshold defaults to the harvester's `minRelevance`. |
| `fetch` | `Function` | global fetch | Custom fetch for proxies/testing |
| `onError` | `Function` | — | Callback for per-source fetch or parse errors |
| `onWarning` | `Function` | — | Callback for non-fatal source diagnostics |

### `harvester.fetchAll()`

Fetches all enabled sources. Returns `Article[]` with event cluster IDs. Related coverage from different sources can share a cluster ID when it falls within 24 hours. Singletons use their article hash as the ID.

If one source fails, the method still returns articles from the remaining sources and reports the problem through `onError` when provided.

### `harvester.fetch(sourceId)`

Fetches a single source by ID.

### `harvester.fetchByTags(tags)`

Fetches sources matching any of the given tags.

### `harvester.digest(options?)`

The main event. Fetches all sources, then runs the compression pipeline:

1. **Dedup** — Groups similar headlines (Jaccard similarity) and keeps the richest version
2. **Sort** — Newest first
3. **Tag budget** — Caps articles per tag so no single region dominates
4. **Truncate** — Cuts content to N characters per article
5. **Token budget** — Trims from the bottom until under the token limit

```typescript
const { articles, stats } = await harvester.digest({
  maxTokens: 12_000,           // total token budget
  maxArticlesPerTag: 10,       // max articles per tag group
  maxContentLength: 500,       // chars per article content
  similarityThreshold: 0.6,    // title dedup threshold (0-1)
  sort: "recency",
});

// stats.totalFetched     → 700  (raw from all sources)
// stats.afterDedup       → 200  (unique stories)
// stats.afterBudget      → 80   (within tag limits)
// stats.estimatedTokens  → 18000 (final token count)
```

### `harvester.start(callbacks)` / `harvester.stop()`

Runs sources on their configured intervals. You handle storage.

```typescript
harvester.start({
  onArticles: async (articles, source) => {
    await db.insert("articles", articles);
    console.log(`${articles.length} new from ${source.name}`);
  },
  onError: (err, source) => {
    console.error(`${source.name} failed:`, err);
  },
  onWarning: (warning, source) => {
    console.warn(`${source.name}: ${warning.code} - ${warning.message}`);
  },
});

// Later:
harvester.stop();
```

## Article Schema

```typescript
interface Article {
  sourceId: string;          // matches source config id
  url: string;               // canonical article URL, always http(s); items with other schemes are skipped
  title: string;
  content: string | null;    // full text (when available)
  summary: string | null;    // first 1–3 clean sentences, up to 400 characters
  publishedAt: Date | null;
  hash: string;              // SHA-256 of URL (dedup key)
  fetchedAt: Date;
  tags: string[];            // inherited from source
  lang: string | null;       // ISO 639-1 when detected
  regions: ArticleRegion[];  // PL, BALTIC, RU, BY, UA, EU or OTHER
  scope: ArticleScope;       // region when a target region is present, otherwise world
  topic: ArticleTopic;       // military, security, politics or other
  relevance: number;         // heuristic score from 0 to 1
  clusterId: string | null;  // assigned by the harvester or clusterArticles()
}
```

Classification checks headlines and up to 2,000 characters of body text with keywords in English, Polish, Russian, Ukrainian and German. Headline matches carry more weight. `EU` covers the wider European context. Regional relevance combines geographic and topical evidence. World scores for military and security use topical evidence on its own scale. Set `world: {}` to enable topic and threshold checks for world articles or set `world: { minRelevance: 0.7 }` to choose a separate threshold. With this policy enabled, source overrides apply to regional articles. Sparse input may leave `lang` unset, and an overlong opening sentence becomes an excerpt.

`clusterArticles(articles, previous?)` can link a new batch to previously saved metadata. It compares normalized headline terms with common words removed. A pair can match at 0.60 title similarity, or at 0.34 with at least four shared words and 0.28 similarity supported by a summary. A new article must match each member. Clustering uses publication time, falling back to fetch time. Headlines in different languages rarely match.

## Dedup Across Sessions

The library handles within-batch dedup automatically. For cross-session dedup (don't re-process articles already in your DB), pass a `known` callback:

```typescript
const harvester = createHarvester({
  sources,
  dedup: {
    known: async () => {
      const rows = await db.query("SELECT hash FROM articles");
      return rows.map(r => r.hash);
    },
  },
});

// fetchAll() now skips articles whose URL hash is already known
```

## Diagnostics

The library keeps the happy path simple: `fetchAll()` and `digest()` still return article data directly.

Use `onError` and `onWarning` if you want visibility into partial failures or weak-quality source output.

- `onError` covers hard failures like timeouts, HTTP errors, and parsing failures.
- `onWarning` covers non-fatal issues like empty source results, missing publication dates, or per-source truncation.
- `below-min-relevance` warnings include `details.rejected`, the source threshold and, when enabled, the world threshold. The count includes world articles outside the eligible topics.

This matches the typical small-library OSS pattern: easy defaults, optional hooks for logging and monitoring.

## Scope and Limits

- RSS and HTML are first-class source types.
- HTML works best when you can define stable list selectors.
- The library does not execute page JavaScript or run a headless browser.
- The included relevance rules target European security and politics. Keep the default threshold of zero to harvest all topics.

## Use with Next.js

```typescript
// app/api/feed/route.ts
import { createHarvester } from "osint-feed";

const harvester = createHarvester({ sources: [...] });

export async function GET() {
  const { articles, stats } = await harvester.digest({ maxTokens: 8000 });
  return Response.json({ articles, stats });
}
```

## Use with Express

```typescript
import express from "express";
import { createHarvester } from "osint-feed";

const app = express();
const harvester = createHarvester({ sources: [...] });

app.get("/digest", async (_req, res) => {
  const result = await harvester.digest();
  res.json(result);
});
```

## How the Digest Math Works

Real numbers from a smoke test with 10 RSS + 3 HTML sources:

```
Raw fetch:         324 articles
After title dedup: 319 unique stories
After tag budget:  47  (8 per tag, 6 tags)
Estimated tokens:  5,781
```

That's **1.8% of Llama 3's 128k context**. Plenty of room for system prompt, history, and reasoning.

With 35 sources polling every 15 min you'd get ~700 articles/hour. The digest pipeline compresses that to ~80 articles / ~18k tokens. Adjust `maxArticlesPerTag` and `maxTokens` to taste.

## Dependencies

Just two:

- [`cheerio`](https://github.com/cheeriojs/cheerio) — HTML parsing
- [`rss-parser`](https://github.com/rbren/rss-parser) — RSS/Atom parsing

No headless browsers. No native modules. No bloat.

## License

MIT

## Disclaimer

This library is a tool for fetching and parsing publicly available web content. Users are responsible for compliance with target websites' terms of service and applicable laws. The authors assume no liability for how the library is used.
