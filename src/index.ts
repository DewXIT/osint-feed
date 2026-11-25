export { createHarvester } from "./harvester.js";
export { buildDigest, dedup } from "./digest.js";
export { fetchRss } from "./rss.js";
export { fetchHtml } from "./html.js";
export { clusterArticles, CLUSTER_WINDOW_MS } from "./clusters.js";
export { enrichArticleText } from "./articleText.js";

export type {
  Article,
  ArticleLanguage,
  ArticleRegion,
  ArticleScope,
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
