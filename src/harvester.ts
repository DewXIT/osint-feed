import type {
  Article,
  DigestOptions,
  DigestResult,
  Harvester,
  HarvesterOptions,
  HarvesterWarning,
  SchedulerCallbacks,
  SourceConfig,
} from "./types.js";
import { fetchRss } from "./rss.js";
import { fetchHtml } from "./html.js";
import { buildDigest } from "./digest.js";
import { createScheduler } from "./scheduler.js";
import { ThrottleQueue } from "./utils.js";
import { clusterArticles, CLUSTER_WINDOW_MS } from "./clusters.js";

type FetchFn = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

const fetchSource = async (
  source: SourceConfig,
  throttle: ThrottleQueue,
  options: {
    readonly fetchFn?: FetchFn;
    readonly timeout?: number;
    readonly maxItemsPerSource?: number;
    readonly onWarning?: (warning: HarvesterWarning, source: SourceConfig) => void;
  } = {},
): Promise<Article[]> => {
  return throttle.run(async () => {
    if (source.type === "rss") {
      const rssOptions: Parameters<typeof fetchRss>[1] = {
        ...(options.fetchFn ? { fetchFn: options.fetchFn } : {}),
        ...(options.timeout !== undefined ? { timeout: options.timeout } : {}),
        ...(options.maxItemsPerSource !== undefined ? { maxItems: options.maxItemsPerSource } : {}),
        ...(options.onWarning
          ? { onWarning: (warning: HarvesterWarning) => options.onWarning?.(warning, source) }
          : {}),
      };
      return fetchRss(source, rssOptions);
    }
    const htmlOptions: Parameters<typeof fetchHtml>[1] = {
      ...(options.fetchFn ? { fetchFn: options.fetchFn } : {}),
      ...(options.timeout !== undefined ? { timeout: options.timeout } : {}),
      ...(options.maxItemsPerSource !== undefined ? { maxItems: options.maxItemsPerSource } : {}),
      ...(options.onWarning
        ? { onWarning: (warning: HarvesterWarning) => options.onWarning?.(warning, source) }
        : {}),
    };
    return fetchHtml(source, htmlOptions);
  });
};

const filterKnown = async (
  articles: Article[],
  knownFn?: () => Promise<readonly string[]> | readonly string[],
): Promise<Article[]> => {
  if (!knownFn) return articles;
  const known = new Set(await knownFn());
  return articles.filter((a) => !known.has(a.hash));
};

export const createHarvester = (options: HarvesterOptions): Harvester => {
  const {
    sources,
    dedup: dedupOpts,
    digest: defaultDigestOpts,
    requestTimeout = 15_000,
    requestGap = 1_000,
    maxItemsPerSource = 50,
    minRelevance = 0,
    onError,
    onWarning,
  } = options;

  const fetchFn = options.fetch;
  const throttle = new ThrottleQueue(requestGap);
  for (const threshold of [minRelevance, ...sources.map((source) => source.minRelevance ?? minRelevance)]) {
    if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
      throw new RangeError("minRelevance must be between 0 and 1");
    }
  }

  let scheduler: { stop: () => void } | null = null;

  const getEnabledSources = (): SourceConfig[] =>
    sources.filter((s) => s.enabled !== false);

  const fetchSingle = async (
    source: SourceConfig,
    warn = onWarning,
  ): Promise<Article[]> => {
    const fetchOptions: Parameters<typeof fetchSource>[2] = {
      timeout: requestTimeout,
      maxItemsPerSource,
      ...(fetchFn ? { fetchFn } : {}),
      ...(warn ? { onWarning: warn } : {}),
    };
    const articles = await fetchSource(source, throttle, fetchOptions);
    const threshold = source.minRelevance ?? minRelevance;
    const accepted = articles.filter((article) => article.relevance >= threshold);
    const rejected = articles.length - accepted.length;
    if (rejected > 0) {
      warn?.({
        code: "below-min-relevance",
        message: "Articles fell below the relevance threshold",
        details: { rejected, minRelevance: threshold },
      }, source);
    }
    return accepted;
  };

  const fetchMany = async (selectedSources: readonly SourceConfig[]): Promise<Article[]> => {
    const results: Article[] = [];
    for (const source of selectedSources) {
      try {
        const articles = await fetchSingle(source);
        results.push(...articles);
      } catch (error) {
        onError?.(error, source);
      }
    }
    return filterKnown(clusterArticles(results), dedupOpts?.known);
  };

  return {
    async fetchAll(): Promise<Article[]> {
      return fetchMany(getEnabledSources());
    },

    async fetch(sourceId: string): Promise<Article[]> {
      const source = sources.find((s) => s.id === sourceId);
      if (!source) {
        throw new Error(`Source not found: ${sourceId}`);
      }
      return filterKnown(clusterArticles(await fetchSingle(source)), dedupOpts?.known);
    },

    async fetchByTags(tags: readonly string[]): Promise<Article[]> {
      const tagSet = new Set(tags);
      const matching = getEnabledSources().filter((s) =>
        s.tags.some((t) => tagSet.has(t)),
      );
      return fetchMany(matching);
    },

    async digest(overrides?: DigestOptions): Promise<DigestResult> {
      const articles = await fetchMany(getEnabledSources());
      const opts = { ...defaultDigestOpts, ...overrides };
      const result = buildDigest(articles, opts);
      return {
        articles: result.articles,
        stats: result.stats,
      };
    },

    start(callbacks: SchedulerCallbacks): void {
      if (scheduler) {
        scheduler.stop();
      }
      const schedulerCallbacks: SchedulerCallbacks = {
        onArticles: callbacks.onArticles,
        ...(callbacks.onError ?? onError ? { onError: callbacks.onError ?? onError } : {}),
        ...(callbacks.onWarning ?? onWarning ? { onWarning: callbacks.onWarning ?? onWarning } : {}),
      };
      const recent = new Map<string, Article>();
      scheduler = createScheduler(
        getEnabledSources(),
        async (source) => {
          const articles = await fetchSingle(source, schedulerCallbacks.onWarning);
          const cutoff = Date.now() - CLUSTER_WINDOW_MS;
          for (const [hash, article] of recent) {
            if ((article.publishedAt ?? article.fetchedAt).getTime() < cutoff) recent.delete(hash);
          }
          const clustered = clusterArticles(articles, [...recent.values()]);
          for (const article of clustered) {
            if ((article.publishedAt ?? article.fetchedAt).getTime() >= cutoff) {
              recent.set(article.hash, article);
            }
          }
          return filterKnown(clustered, dedupOpts?.known);
        },
        schedulerCallbacks,
      );
    },

    stop(): void {
      scheduler?.stop();
      scheduler = null;
    },
  };
};
