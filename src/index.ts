export { createHarvester } from "./harvester.js";
export { buildDigest, dedup } from "./digest.js";
export { fetchRss } from "./rss.js";
export { fetchHtml } from "./html.js";
export { clusterArticles, CLUSTER_WINDOW_MS } from "./clusters.js";

export type {
  Article,
  ArticleLanguage,
  ArticleRegion,
  ArticleTopic,
  DigestOptions,
  DigestResult,
  Harvester,
  HarvesterOptions,
  HtmlSelectors,
  HtmlSourceConfig,
  HarvesterWarning,
  HarvesterWarningCode,
  KnownHashesFn,
  RssSourceConfig,
  SchedulerCallbacks,
  SourceConfig,
} from "./types.js";
