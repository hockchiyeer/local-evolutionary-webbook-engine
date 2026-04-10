import { RewardProfile, SearchFallbackPayload, SearchSourceConfig, SearchSourceKey, WebBook, WebPageGenotype } from "../types";

export type SearchBatchProvider = SearchSourceKey | "manual" | "local-synthesis" | "search-fallback";

export interface SearchProgressUpdate {
  provider: SearchBatchProvider;
  phase: "started" | "completed";
  batchResults: WebPageGenotype[];
  mergedResults: WebPageGenotype[];
  completed: number;
  total: number;
  durationMs?: number;
  error?: string;
}

type SearchRequestConfig = SearchSourceConfig & {
  disableMockFallback?: boolean;
};

const EMPTY_SOURCE_SELECTION = {
  wikipedia: false,
  openlibrary: false,
  crossref: false,
  duckduckgo: false,
  google: false,
  bing: false,
};

const SEARCH_PROVIDER_ORDER: SearchSourceKey[] = [
  "wikipedia",
  "openlibrary",
  "crossref",
  "duckduckgo",
  "google",
  "bing",
];

const WEB_SEARCH_PROVIDER_KEYS: SearchSourceKey[] = ["duckduckgo", "google", "bing"];
const SEARCH_FALLBACK_MAX_MERGE_COUNT = 12;

function deepDecodeUtf8(obj: any): any {
  if (typeof obj === 'string') {
    try {
      return decodeURIComponent(escape(obj));
    } catch {
      return obj;
    }
  }
  if (Array.isArray(obj)) {
    return obj.map(deepDecodeUtf8);
  }
  if (obj !== null && typeof obj === 'object') {
    return Object.fromEntries(
      Object.entries(obj).map(([key, val]) => [key, deepDecodeUtf8(val)])
    );
  }
  return obj;
}

async function readResponseBody(response: Response) {
  const buffer = await response.arrayBuffer();
  const text = new TextDecoder('utf-8').decode(buffer);
  const contentType = response.headers.get("content-type") || "";

  if (!text) {
    return null;
  }

  if (contentType.includes("application/json")) {
    return deepDecodeUtf8(JSON.parse(text));
  }

  try {
    return deepDecodeUtf8(JSON.parse(text));
  } catch {
    // If it's a raw string, decode it directly
    return deepDecodeUtf8(text);
  }
}

const SEARCH_REQUEST_TIMEOUT_MS = 420000;
const PROCESS_REQUEST_TIMEOUT_MS = 480000;

const ENDPOINT_TIMEOUT_MS: Record<string, number> = {
  search: SEARCH_REQUEST_TIMEOUT_MS,
  evolve: PROCESS_REQUEST_TIMEOUT_MS,
  assemble: PROCESS_REQUEST_TIMEOUT_MS,
};

async function callApi(endpoint: string, body: any) {
  const controller = new AbortController();
  const timeoutMs = ENDPOINT_TIMEOUT_MS[endpoint] ?? SEARCH_REQUEST_TIMEOUT_MS;
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;

  try {
    response = await fetch(`/api/${endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (error: any) {
    window.clearTimeout(timeoutId);

    if (error?.name === "AbortError") {
      throw new Error(`The ${endpoint} request timed out after ${Math.round(timeoutMs / 1000)} seconds.`);
    }

    throw error;
  }

  window.clearTimeout(timeoutId);

  const parsedBody = await readResponseBody(response);

  if (!response.ok) {
    if (typeof parsedBody === "string") {
      const compactMessage = parsedBody.replace(/\s+/g, " ").trim();
      const message = compactMessage.startsWith("<")
        ? `The server returned a non-JSON error while calling /api/${endpoint}. Check the dev server logs.`
        : compactMessage;
      throw new Error(message || `API call to ${endpoint} failed`);
    }

    const error = parsedBody as { error?: string; details?: string } | null;
    throw new Error(error?.error || error?.details || `API call to ${endpoint} failed`);
  }

  if (typeof parsedBody === "string") {
    throw new Error(`The server returned invalid JSON for /api/${endpoint}. Check the dev server logs.`);
  }

  return parsedBody;
}

function buildBatchConfigs(sourceConfig: SearchSourceConfig): Array<{
  provider: SearchBatchProvider;
  config: SearchRequestConfig;
}> {
  const batches: Array<{
    provider: SearchBatchProvider;
    config: SearchRequestConfig;
  }> = SEARCH_PROVIDER_ORDER
    .filter((provider) => sourceConfig.sources[provider])
    .map((provider) => ({
      provider,
      config: {
        sources: {
          ...EMPTY_SOURCE_SELECTION,
          [provider]: true,
        },
        manualUrls: [],
        executionMode: sourceConfig.executionMode,
        disableMockFallback: true,
      },
    }));

  if (sourceConfig.manualUrls.length > 0) {
    batches.push({
      provider: "manual",
      config: {
        sources: { ...EMPTY_SOURCE_SELECTION },
        manualUrls: sourceConfig.manualUrls,
        executionMode: sourceConfig.executionMode,
        disableMockFallback: true,
      },
    });
  }

  return batches;
}

function normalizeUrlForKey(url: string) {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    const pathname = parsed.pathname.replace(/\/+$/, "") || "/";
    return `${parsed.protocol}//${parsed.host}${pathname}${parsed.search}`;
  } catch {
    return url.trim().toLowerCase();
  }
}

function uniqueProviders(result: Partial<WebPageGenotype>) {
  const providers = new Set<string>();

  (result.searchProviders || []).forEach((provider) => {
    if (provider) {
      providers.add(provider);
    }
  });

  if (result.searchProvider) {
    providers.add(result.searchProvider);
  }

  return Array.from(providers);
}

function normalizeSearchResult(rawResult: any, index: number): WebPageGenotype {
  const providers = uniqueProviders(rawResult);

  return {
    ...rawResult,
    id: `gen-${Date.now()}-${index}`,
    url: rawResult.url || "",
    title: rawResult.title || "Untitled Source",
    content: rawResult.content ? String(rawResult.content).substring(0, 3000) : "",
    definitions: (rawResult.definitions || []).map((definition: any) => ({
      ...definition,
      sourceUrl: definition.sourceUrl || rawResult.url || "",
    })),
    subTopics: (rawResult.subTopics || []).map((subTopic: any) => ({
      ...subTopic,
      sourceUrl: subTopic.sourceUrl || rawResult.url || "",
    })),
    informativeScore: Number(rawResult.informativeScore || 0),
    authorityScore: Number(rawResult.authorityScore || 0),
    fitness: Number(rawResult.fitness || 0),
    searchProvider: providers[0] || rawResult.searchProvider,
    searchProviders: providers,
  };
}

function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function canUseLiveSearchFallback(sourceConfig: SearchSourceConfig): boolean {
  return WEB_SEARCH_PROVIDER_KEYS.some((provider) => sourceConfig.sources[provider]);
}

function buildSearchFallbackDecision(results: WebPageGenotype[], errors: string[]) {
  const providerCount = new Set(
    results.flatMap((result) => uniqueProviders(result)).filter((provider) => provider && provider !== "page-fetch")
  ).size;
  const richResultCount = results.filter((result) => {
    const structureCount = (result.definitions?.length || 0) + (result.subTopics?.length || 0);
    return result.content.length >= 360 || structureCount >= 3;
  }).length;
  const avgInformative = average(results.map((result) => Number(result.informativeScore || 0)));
  const avgAuthority = average(results.map((result) => Number(result.authorityScore || 0)));
  const reasons: string[] = [];

  if (results.length === 0) {
    reasons.push("no-frontier");
  }
  if (results.length > 0 && results.length < 6) {
    reasons.push("thin-frontier");
  }
  if (results.length > 0 && providerCount < 3) {
    reasons.push("low-provider-diversity");
  }
  if (results.length > 0 && richResultCount < Math.min(4, Math.max(2, Math.ceil(results.length * 0.45)))) {
    reasons.push("shallow-evidence");
  }
  if (results.length > 0 && (avgInformative < 0.6 || avgAuthority < 0.62)) {
    reasons.push("weak-frontier-signals");
  }
  if (errors.length > 0 && results.length < 12) {
    reasons.push("provider-failures");
  }

  if (reasons.length === 0) {
    return {
      shouldSupplement: false,
      desiredCount: 0,
    };
  }

  let desiredCount = 8;
  if (results.length === 0) {
    desiredCount = 12;
  } else if (results.length < 4 || providerCount < 2) {
    desiredCount = 10;
  }

  if (errors.length > 0) {
    desiredCount += 2;
  }

  return {
    shouldSupplement: true,
    desiredCount: Math.min(SEARCH_FALLBACK_MAX_MERGE_COUNT, desiredCount),
  };
}

function estimateFallbackAuthority(domain: string): number {
  const normalizedDomain = domain.toLowerCase();

  if (normalizedDomain.includes("wikipedia.org")) return 0.92;
  if (normalizedDomain.endsWith(".gov")) return 0.88;
  if (normalizedDomain.endsWith(".edu")) return 0.84;
  if (normalizedDomain.endsWith(".org")) return 0.78;
  if (normalizedDomain.endsWith(".com")) return 0.68;
  return 0.63;
}

function estimateFallbackInformative(content: string, query: string): number {
  const normalizedContent = content.toLowerCase();
  const queryTokens = query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3);
  const overlap = queryTokens.length === 0
    ? 0
    : queryTokens.filter((token) => normalizedContent.includes(token)).length / queryTokens.length;
  const lengthScore = Math.min(content.length / 540, 1);

  return Number(Math.min(0.92, Math.max(0.48, (overlap * 0.55) + (lengthScore * 0.45))).toFixed(4));
}

function buildFallbackResultContent(
  payload: SearchFallbackPayload,
  result: SearchFallbackPayload["results"][number],
): string {
  const parts = [result.title, result.snippet, result.excerpt];
  return parts
    .filter(Boolean)
    .map((part) => String(part).trim())
    .join(". ")
    .replace(/\.\s+\./g, ".")
    .slice(0, 2400)
    || payload.summary.slice(0, 2400);
}

function mapSearchFallbackPayloadToPopulation(
  payload: SearchFallbackPayload,
  query: string,
  desiredCount: number,
): WebPageGenotype[] {
  return payload.results.slice(0, desiredCount).map((result, index) => {
    const content = buildFallbackResultContent(payload, result);
    const providers = Array.from(new Set([result.provider, "search-fallback"]));

    return {
      id: `fallback-${payload.extractedAt}-${index}`,
      url: result.url,
      title: result.title || `${result.domain} reference`,
      content,
      definitions: [],
      subTopics: [],
      informativeScore: estimateFallbackInformative(content, query),
      authorityScore: estimateFallbackAuthority(result.domain),
      fitness: 0,
      searchProvider: result.provider,
      searchProviders: providers,
    };
  });
}

function dedupeDefinitionList(definitions: WebPageGenotype["definitions"]) {
  const seen = new Set<string>();

  return definitions.filter((definition) => {
    const key = [
      definition.term?.trim().toLowerCase(),
      definition.description?.trim().toLowerCase(),
      definition.sourceUrl?.trim().toLowerCase(),
    ].join("::");

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function dedupeSubTopicList(subTopics: WebPageGenotype["subTopics"]) {
  const seen = new Set<string>();

  return subTopics.filter((subTopic) => {
    const key = [
      subTopic.title?.trim().toLowerCase(),
      subTopic.summary?.trim().toLowerCase(),
      subTopic.sourceUrl?.trim().toLowerCase(),
    ].join("::");

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function mergeSearchResults(existing: WebPageGenotype[], incoming: WebPageGenotype[]) {
  const merged = new Map<string, WebPageGenotype>();

  [...existing, ...incoming].forEach((result) => {
    const key = result.url
      ? normalizeUrlForKey(result.url)
      : `${result.title.trim().toLowerCase()}::${result.content.trim().toLowerCase().slice(0, 180)}`;
    const current = merged.get(key);

    if (!current) {
      merged.set(key, { ...result });
      return;
    }

    const providers = Array.from(new Set([...uniqueProviders(current), ...uniqueProviders(result)]));

    merged.set(key, {
      ...current,
      title: current.title.length >= result.title.length ? current.title : result.title,
      url: current.url || result.url,
      content: current.content.length >= result.content.length ? current.content : result.content,
      definitions: dedupeDefinitionList([...current.definitions, ...result.definitions]),
      subTopics: dedupeSubTopicList([...current.subTopics, ...result.subTopics]),
      informativeScore: Math.max(current.informativeScore || 0, result.informativeScore || 0),
      authorityScore: Math.max(current.authorityScore || 0, result.authorityScore || 0),
      fitness: Math.max(current.fitness || 0, result.fitness || 0),
      searchProvider: providers[0],
      searchProviders: providers,
    });
  });

  return Array.from(merged.values()).map((result, index) => ({
    ...result,
    id: `gen-${Date.now()}-${index}`,
  }));
}

async function runSearchBatch(query: string, sourceConfig: SearchRequestConfig) {
  const results = await callApi("search", { query, sourceConfig });

  if (!Array.isArray(results)) {
    return [];
  }

  return results.map((result: any, index: number) => normalizeSearchResult(result, index));
}

export async function searchAndExtract(
  query: string,
  sourceConfig: SearchSourceConfig,
  onProgress?: (update: SearchProgressUpdate) => void,
): Promise<WebPageGenotype[]> {
  const batchConfigs = buildBatchConfigs(sourceConfig);

  if (batchConfigs.length === 0) {
    return [];
  }

  let mergedResults: WebPageGenotype[] = [];
  let completed = 0;
  const errors: string[] = [];

  const runBatch = async (provider: SearchBatchProvider, config: SearchRequestConfig) => {
    const startedAt = Date.now();
    onProgress?.({
      provider,
      phase: "started",
      batchResults: [],
      mergedResults,
      completed,
      total: batchConfigs.length,
      durationMs: 0,
    });

    try {
      const batchResults = await runSearchBatch(query, config);
      mergedResults = mergeSearchResults(mergedResults, batchResults);
      completed += 1;
      onProgress?.({
        provider,
        phase: "completed",
        batchResults,
        mergedResults,
        completed,
        total: batchConfigs.length,
        durationMs: Date.now() - startedAt,
      });
    } catch (error: any) {
      completed += 1;
      const message = error?.message || `Search failed for ${provider}`;
      errors.push(message);
      onProgress?.({
        provider,
        phase: "completed",
        batchResults: [],
        mergedResults,
        completed,
        total: batchConfigs.length,
        durationMs: Date.now() - startedAt,
        error: message,
      });
    }
  };

  if (sourceConfig.executionMode === "parallel") {
    await Promise.all(batchConfigs.map(({ provider, config }) => runBatch(provider, config)));
  } else {
    for (const { provider, config } of batchConfigs) {
      await runBatch(provider, config);
    }
  }

  const fallbackDecision = canUseLiveSearchFallback(sourceConfig)
    ? buildSearchFallbackDecision(mergedResults, errors)
    : { shouldSupplement: false, desiredCount: 0 };

  if (fallbackDecision.shouldSupplement) {
    const startedAt = Date.now();
    onProgress?.({
      provider: "search-fallback",
      phase: "started",
      batchResults: [],
      mergedResults,
      completed,
      total: batchConfigs.length + 1,
      durationMs: 0,
    });

    try {
      const { fetchSearchFallback } = await import("./searchFallbackService");
      const payload = await fetchSearchFallback(query);
      const fallbackResults = mapSearchFallbackPayloadToPopulation(payload, query, fallbackDecision.desiredCount);

      if (fallbackResults.length > 0) {
        mergedResults = mergeSearchResults(mergedResults, fallbackResults);
      }

      completed += 1;
      onProgress?.({
        provider: "search-fallback",
        phase: "completed",
        batchResults: fallbackResults,
        mergedResults,
        completed,
        total: batchConfigs.length + 1,
        durationMs: Date.now() - startedAt,
      });
    } catch (error: any) {
      completed += 1;
      const message = error?.message || "Supplemental live search failed";
      errors.push(message);
      onProgress?.({
        provider: "search-fallback",
        phase: "completed",
        batchResults: [],
        mergedResults,
        completed,
        total: batchConfigs.length + 1,
        durationMs: Date.now() - startedAt,
        error: message,
      });
    }
  }

  if (mergedResults.length === 0) {
    const fallbackStartedAt = Date.now();
    const fallbackResults = await runSearchBatch(query, {
      sources: { ...EMPTY_SOURCE_SELECTION },
      manualUrls: [],
      executionMode: "sequential",
    });

    if (fallbackResults.length > 0) {
      mergedResults = mergeSearchResults([], fallbackResults);
      onProgress?.({
        provider: "local-synthesis",
        phase: "completed",
        batchResults: fallbackResults,
        mergedResults,
        completed,
        total: batchConfigs.length,
        durationMs: Date.now() - fallbackStartedAt,
        error: errors.length > 0 ? Array.from(new Set(errors)).join(" | ") : undefined,
      });
    }
  }

  if (mergedResults.length === 0 && errors.length > 0) {
    throw new Error(Array.from(new Set(errors)).join(" | "));
  }

  return mergedResults;
}

export async function evolve(
  population: WebPageGenotype[],
  query: string,
  generations: number = 3,
  rewardProfile?: RewardProfile,
): Promise<WebPageGenotype[]> {
  return await callApi("evolve", { query, population, generations, rewardProfile });
}

export async function assembleWebBook(
  optimalPopulation: WebPageGenotype[],
  topic: string,
  rewardProfile?: RewardProfile,
): Promise<any> {
  return await callApi("assemble", { query: topic, population: optimalPopulation, rewardProfile });
}

export interface FeedbackLearningResponse {
  rewardProfile: RewardProfile;
  recordCount: number;
  updatedAt: number | null;
}

function serializeFeedbackBook(book: WebBook) {
  return {
    id: book.id,
    topic: book.topic,
    topicArea: book.topicArea,
    timestamp: book.timestamp,
    chapters: book.chapters.map((chapter, index) => ({
      id: chapter.id || `${book.id}-chapter-${index + 1}`,
      title: chapter.title,
    })),
    feedback: book.feedback,
  };
}

export async function getPersistentRewardProfile(): Promise<FeedbackLearningResponse> {
  return await callApi("feedback/profile", {});
}

export async function savePersistentFeedback(book: WebBook): Promise<FeedbackLearningResponse> {
  return await callApi("feedback/upsert", { book: serializeFeedbackBook(book) });
}

export async function bootstrapPersistentFeedback(books: WebBook[]): Promise<FeedbackLearningResponse> {
  return await callApi("feedback/bootstrap", {
    books: books.map((book) => serializeFeedbackBook(book)),
  });
}
