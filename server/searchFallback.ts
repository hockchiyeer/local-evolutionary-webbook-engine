import type {
  SearchFallbackPayload,
  SearchFallbackProvider,
  SearchFallbackResult,
  SearchFallbackSource,
} from "../src/types";

const GOOGLE_SEARCH_URL = "https://www.google.com/search";
const DUCKDUCKGO_HTML_URL = "https://html.duckduckgo.com/html/";
const DUCKDUCKGO_INSTANT_ANSWER_URL = "https://api.duckduckgo.com/";
const SEARCH_TIMEOUT_MS = 15000;
const MAX_RESULTS = 36;
const MAX_RESULTS_PER_PROVIDER = 18;
const SEARCH_QUERY_VARIANTS = ["", "overview", "guide", "key concepts", "applications", "history"];
const FALLBACK_STOPWORDS = new Set([
  "about",
  "after",
  "also",
  "amid",
  "among",
  "and",
  "around",
  "been",
  "between",
  "from",
  "into",
  "over",
  "that",
  "their",
  "them",
  "they",
  "this",
  "through",
  "under",
  "with",
]);

const DEFAULT_HEADERS: HeadersInit = {
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "accept-language": "en-US,en;q=0.9",
  "cache-control": "no-cache",
  "user-agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36",
};

type SearchFetchResult = {
  label: string;
  url: string;
  status: number;
  html: string;
};

function decodeHtmlEntities(input: string): string {
  return input.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (entity, value: string) => {
    if (value[0] === "#") {
      const numericValue = value[1]?.toLowerCase() === "x"
        ? Number.parseInt(value.slice(2), 16)
        : Number.parseInt(value.slice(1), 10);

      if (Number.isFinite(numericValue)) {
        return String.fromCodePoint(numericValue);
      }

      return entity;
    }

    switch (value) {
      case "amp":
        return "&";
      case "lt":
        return "<";
      case "gt":
        return ">";
      case "quot":
        return "\"";
      case "apos":
      case "#39":
        return "'";
      case "nbsp":
        return " ";
      default:
        return entity;
    }
  });
}

function collapseWhitespace(input: string): string {
  return input.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function stripHtmlToText(input: string): string {
  return collapseWhitespace(
    decodeHtmlEntities(
      input
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
        .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<\/(p|div|li|section|article|table|tr|td|h\d|span)>/gi, "\n")
        .replace(/<[^>]+>/g, " ")
    )
  );
}

function normalizeComparableText(input: string): string {
  return collapseWhitespace(
    input
      .toLowerCase()
      .replace(/&/g, " and ")
      .replace(/[^a-z0-9\s]/g, " ")
  );
}

function tokenizeComparableText(input: string): string[] {
  return normalizeComparableText(input)
    .split(" ")
    .filter((token) => token.length >= 3 && !FALLBACK_STOPWORDS.has(token));
}

function calculateTextSimilarity(left: string, right: string): number {
  const normalizedLeft = normalizeComparableText(left);
  const normalizedRight = normalizeComparableText(right);

  if (!normalizedLeft || !normalizedRight) {
    return 0;
  }

  if (normalizedLeft === normalizedRight) {
    return 1;
  }

  const shorter = normalizedLeft.length <= normalizedRight.length ? normalizedLeft : normalizedRight;
  const longer = shorter === normalizedLeft ? normalizedRight : normalizedLeft;
  if (shorter.length >= 28 && longer.includes(shorter)) {
    return 0.96;
  }

  const leftTokens = new Set(tokenizeComparableText(left));
  const rightTokens = new Set(tokenizeComparableText(right));
  if (leftTokens.size === 0 || rightTokens.size === 0) {
    return 0;
  }

  let overlap = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) {
      overlap += 1;
    }
  }

  return overlap / new Set([...leftTokens, ...rightTokens]).size;
}

function buildSearchQueryVariants(query: string): string[] {
  const baseQuery = collapseWhitespace(query);
  const normalizedBase = normalizeComparableText(baseQuery);
  const variants: string[] = [];
  const seen = new Set<string>();

  for (const suffix of SEARCH_QUERY_VARIANTS) {
    const candidate = suffix ? `${baseQuery} ${suffix}` : baseQuery;
    const normalizedCandidate = normalizeComparableText(candidate);

    if (!normalizedCandidate || seen.has(normalizedCandidate)) {
      continue;
    }

    if (suffix && normalizedCandidate === normalizedBase) {
      continue;
    }

    seen.add(normalizedCandidate);
    variants.push(candidate);
  }

  return variants.length > 0 ? variants : [baseQuery];
}

function isSearchEngineInternalUrl(url: string): boolean {
  return /(^https?:\/\/(?:www\.)?(?:google|duckduckgo)\.[^/]+)|(^\/search)|(^\/url\?)/i.test(url);
}

function sanitizeSnippet(text: string): string {
  const cleaned = collapseWhitespace(
    text
      .replace(/\s*\.\.\.\s*/g, ". ")
      .replace(/\s*-\s*Wikipedia$/i, "")
      .replace(/\bCached\b|\bTranslate this page\b/gi, "")
  );
  if (!cleaned) {
    return "";
  }

  const sentences = cleaned
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => collapseWhitespace(sentence))
    .filter(Boolean);

  const deduped: string[] = [];
  for (const sentence of sentences) {
    if (deduped.some((current) => calculateTextSimilarity(current, sentence) >= 0.92)) {
      continue;
    }
    deduped.push(sentence);
    if (deduped.length >= 3) {
      break;
    }
  }

  const joined = deduped.join(" ").trim();
  return joined.slice(0, 640);
}

function getDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, "");
  } catch {
    return "";
  }
}

function normalizeGoogleSearchHref(rawHref: string): string | null {
  try {
    const decodedHref = decodeHtmlEntities(rawHref);

    if (decodedHref.startsWith("http://") || decodedHref.startsWith("https://")) {
      return decodedHref;
    }

    const url = new URL(decodedHref, "https://www.google.com");
    if (!/google\./i.test(url.hostname)) {
      return url.toString();
    }

    if (url.pathname === "/url") {
      return url.searchParams.get("q") || url.searchParams.get("url");
    }

    return null;
  } catch {
    return null;
  }
}

function normalizeDuckDuckGoHref(rawHref: string): string | null {
  try {
    const decodedHref = decodeHtmlEntities(rawHref);
    if (decodedHref.startsWith("http://") || decodedHref.startsWith("https://")) {
      return decodedHref;
    }

    const url = new URL(decodedHref, "https://duckduckgo.com");
    if (!/duckduckgo\./i.test(url.hostname)) {
      return url.toString();
    }

    const target = url.searchParams.get("uddg");
    return target ? decodeURIComponent(target) : null;
  } catch {
    return null;
  }
}

function buildSearchResult(
  provider: SearchFallbackProvider,
  title: string,
  url: string,
  snippet: string,
  excerpt?: string,
): SearchFallbackResult | null {
  const normalizedTitle = collapseWhitespace(stripHtmlToText(title));
  const normalizedUrl = collapseWhitespace(url);
  const normalizedSnippet = sanitizeSnippet(stripHtmlToText(snippet));
  const normalizedExcerpt = excerpt ? sanitizeSnippet(stripHtmlToText(excerpt)) : undefined;
  const domain = getDomain(normalizedUrl);

  if (!normalizedTitle || !normalizedUrl || isSearchEngineInternalUrl(normalizedUrl) || !domain) {
    return null;
  }

  const fullText = [normalizedTitle, normalizedSnippet, normalizedExcerpt].filter(Boolean).join(". ");
  if (fullText.length < 48) {
    return null;
  }

  return {
    title: normalizedTitle,
    url: normalizedUrl,
    domain,
    snippet: normalizedSnippet || normalizedTitle,
    excerpt: normalizedExcerpt,
    provider,
  };
}

function extractSearchResultsFromGoogleHtml(html: string): SearchFallbackResult[] {
  const resultPattern = /<a[^>]+href="(?<href>\/url\?q=[^"&]+)[^"]*"[^>]*>[\s\S]*?<h3[^>]*>(?<title>[\s\S]*?)<\/h3>[\s\S]*?(?:<div[^>]+class="[^"]*(?:VwiC3b|yDqY9b|s|st)[^"]*"[^>]*>|<span[^>]+class="[^"]*st[^"]*"[^>]*>)(?<snippet>[\s\S]*?)(?:<\/div>|<\/span>)/gi;
  const minimalPattern = /<a[^>]+href="(?<href>\/url\?q=[^"&]+)[^"]*"[^>]*>[\s\S]*?<h3[^>]*>(?<title>[\s\S]*?)<\/h3>/gi;

  const results: SearchFallbackResult[] = [];
  const seenUrls = new Set<string>();
  const matches = [...html.matchAll(resultPattern)];
  const fallbackMatches = matches.length > 0 ? matches : [...html.matchAll(minimalPattern)];

  for (const match of fallbackMatches) {
    const href = match.groups?.href;
    const title = match.groups?.title || "";
    const snippet = match.groups?.snippet || "";
    const url = href ? normalizeGoogleSearchHref(href) : null;

    if (!url || seenUrls.has(url)) {
      continue;
    }

    const result = buildSearchResult("google", title, url, snippet);
    if (!result) {
      continue;
    }

    seenUrls.add(url);
    results.push(result);
    if (results.length >= MAX_RESULTS_PER_PROVIDER) {
      break;
    }
  }

  return results;
}

function extractSearchResultsFromDuckDuckGoHtml(html: string): SearchFallbackResult[] {
  const resultPattern = /<div[^>]+class="[^"]*result[^"]*"[^>]*>[\s\S]*?<a[^>]+class="result__a"[^>]+href="(?<href>[^"]+)"[^>]*>(?<title>[\s\S]*?)<\/a>[\s\S]*?(?:<a[^>]+class="result__snippet"[^>]*>|<div[^>]+class="result__snippet"[^>]*>)(?<snippet>[\s\S]*?)(?:<\/a>|<\/div>)/gi;
  const results: SearchFallbackResult[] = [];
  const seenUrls = new Set<string>();

  for (const match of html.matchAll(resultPattern)) {
    const href = match.groups?.href;
    const title = match.groups?.title || "";
    const snippet = match.groups?.snippet || "";
    const url = href ? normalizeDuckDuckGoHref(href) : null;

    if (!url || seenUrls.has(url)) {
      continue;
    }

    const result = buildSearchResult("duckduckgo", title, url, snippet);
    if (!result) {
      continue;
    }

    seenUrls.add(url);
    results.push(result);
    if (results.length >= MAX_RESULTS_PER_PROVIDER) {
      break;
    }
  }

  return results;
}

function extractSearchResultsFromDuckDuckGoInstantAnswer(payload: any): SearchFallbackResult[] {
  const rawTopics = [
    ...(Array.isArray(payload?.Results) ? payload.Results : []),
    ...(Array.isArray(payload?.RelatedTopics) ? payload.RelatedTopics : []),
  ];

  const flattened = rawTopics.flatMap((item: any) => Array.isArray(item?.Topics) ? item.Topics : [item]);
  const results: SearchFallbackResult[] = [];
  const seenUrls = new Set<string>();

  for (const item of flattened) {
    const url = typeof item?.FirstURL === "string" ? item.FirstURL : "";
    const text = typeof item?.Text === "string" ? item.Text : "";
    if (!url || !text || seenUrls.has(url)) {
      continue;
    }

    const pieces = text.split(" - ");
    const title = pieces[0] || text;
    const snippet = pieces.slice(1).join(" - ") || text;
    const result = buildSearchResult("duckduckgo", title, url, snippet, text);
    if (!result) {
      continue;
    }

    seenUrls.add(url);
    results.push(result);
    if (results.length >= 10) {
      break;
    }
  }

  return results;
}

async function fetchSearchHtml(url: URL, label: string): Promise<SearchFetchResult> {
  const response = await fetch(url, {
    headers: DEFAULT_HEADERS,
    redirect: "follow",
    signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
  });

  const html = await response.text();
  return {
    label,
    url: url.toString(),
    status: response.status,
    html,
  };
}

async function fetchGoogleAttempts(query: string, labelSuffix: string): Promise<SearchFetchResult[]> {
  const basicUrl = new URL(GOOGLE_SEARCH_URL);
  basicUrl.searchParams.set("q", query);
  basicUrl.searchParams.set("hl", "en");
  basicUrl.searchParams.set("gl", "us");
  basicUrl.searchParams.set("gbv", "1");
  basicUrl.searchParams.set("num", "12");
  basicUrl.searchParams.set("pws", "0");

  const webOnlyUrl = new URL(GOOGLE_SEARCH_URL);
  webOnlyUrl.searchParams.set("q", query);
  webOnlyUrl.searchParams.set("hl", "en");
  webOnlyUrl.searchParams.set("gl", "us");
  webOnlyUrl.searchParams.set("udm", "14");
  webOnlyUrl.searchParams.set("num", "10");
  webOnlyUrl.searchParams.set("pws", "0");

  const settled = await Promise.allSettled([
    fetchSearchHtml(basicUrl, `google-basic-${labelSuffix}`),
    fetchSearchHtml(webOnlyUrl, `google-web-${labelSuffix}`),
  ]);

  return settled
    .filter((result): result is PromiseFulfilledResult<SearchFetchResult> => result.status === "fulfilled")
    .map((result) => result.value);
}

async function fetchDuckDuckGoAttempt(query: string, labelSuffix: string): Promise<SearchFetchResult | null> {
  const searchUrl = new URL(DUCKDUCKGO_HTML_URL);
  searchUrl.searchParams.set("q", query);
  searchUrl.searchParams.set("kl", "us-en");

  try {
    return await fetchSearchHtml(searchUrl, `duckduckgo-html-${labelSuffix}`);
  } catch {
    return null;
  }
}

async function fetchDuckDuckGoInstantAnswer(query: string): Promise<SearchFallbackResult[]> {
  try {
    const endpoint = new URL(DUCKDUCKGO_INSTANT_ANSWER_URL);
    endpoint.searchParams.set("q", query);
    endpoint.searchParams.set("format", "json");
    endpoint.searchParams.set("no_html", "1");
    endpoint.searchParams.set("skip_disambig", "1");

    const response = await fetch(endpoint, {
      headers: {
        accept: "application/json",
        "user-agent": DEFAULT_HEADERS["user-agent"] as string,
      },
      signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
    });

    if (!response.ok) {
      return [];
    }

    const payload = await response.json();
    return extractSearchResultsFromDuckDuckGoInstantAnswer(payload);
  } catch {
    return [];
  }
}

function selectDistinctSearchResults(results: SearchFallbackResult[], maxResults = MAX_RESULTS): SearchFallbackResult[] {
  const selected: SearchFallbackResult[] = [];

  for (const result of results) {
    if (!result.url || selected.length >= maxResults) {
      continue;
    }

    const duplicated = selected.some((existing) => {
      if (existing.url === result.url) {
        return true;
      }

      const titleSimilarity = calculateTextSimilarity(existing.title, result.title);
      const snippetSimilarity = calculateTextSimilarity(
        `${existing.snippet} ${existing.excerpt || ""}`,
        `${result.snippet} ${result.excerpt || ""}`,
      );

      return titleSimilarity >= 0.96 || snippetSimilarity >= 0.95;
    });

    if (duplicated) {
      continue;
    }

    selected.push(result);
  }

  return selected;
}

function interleaveSearchResults(primary: SearchFallbackResult[], alternate: SearchFallbackResult[]): SearchFallbackResult[] {
  const blended: SearchFallbackResult[] = [];
  const maxLength = Math.max(primary.length, alternate.length);

  for (let index = 0; index < maxLength; index += 1) {
    if (primary[index]) {
      blended.push(primary[index]);
    }
    if (alternate[index]) {
      blended.push(alternate[index]);
    }
  }

  return blended;
}

function buildSummary(query: string, results: SearchFallbackResult[]): string {
  const sentences: string[] = [];

  for (const result of results) {
    const chunks = [result.snippet, result.excerpt]
      .filter(Boolean)
      .join(" ")
      .split(/(?<=[.!?])\s+/)
      .map((sentence) => collapseWhitespace(sentence))
      .filter(Boolean);

    for (const sentence of chunks) {
      if (sentences.some((existing) => calculateTextSimilarity(existing, sentence) >= 0.9)) {
        continue;
      }

      sentences.push(sentence);
      if (sentences.length >= 4) {
        break;
      }
    }

    if (sentences.length >= 4) {
      break;
    }
  }

  if (sentences.length === 0) {
    return `Supplemental live-search evidence was collected for ${query}.`;
  }

  return sentences.join(" ").slice(0, 1800);
}

function buildDiagnostics(fetches: SearchFetchResult[], resultsCount: number, provider: SearchFallbackProvider): string[] {
  const diagnostics = fetches.map((attempt) => `${attempt.label}:${attempt.status}`);
  diagnostics.push(`${provider}-results:${resultsCount}`);
  return diagnostics;
}

export async function buildSearchFallbackPayload(query: string): Promise<SearchFallbackPayload> {
  const queryVariants = buildSearchQueryVariants(query);
  const googleAttemptGroups = await Promise.all(
    queryVariants.map((variant, index) => fetchGoogleAttempts(variant, `q${index + 1}`))
  );
  const googleAttempts = googleAttemptGroups.flat();
  const googleResults = selectDistinctSearchResults(
    googleAttempts.flatMap((attempt) => extractSearchResultsFromGoogleHtml(attempt.html)),
    MAX_RESULTS_PER_PROVIDER,
  );

  const duckDuckGoAttemptResults = await Promise.all(
    queryVariants.map((variant, index) => fetchDuckDuckGoAttempt(variant, `q${index + 1}`))
  );
  const duckDuckGoAttempts = duckDuckGoAttemptResults.filter((attempt): attempt is SearchFetchResult => Boolean(attempt));
  let alternateResults = selectDistinctSearchResults(
    duckDuckGoAttempts.flatMap((attempt) => extractSearchResultsFromDuckDuckGoHtml(attempt.html)),
    MAX_RESULTS_PER_PROVIDER,
  );

  if (alternateResults.length === 0) {
    alternateResults = selectDistinctSearchResults(await fetchDuckDuckGoInstantAnswer(query), 10);
  }

  const blendedResults = selectDistinctSearchResults(
    interleaveSearchResults(googleResults, alternateResults),
    MAX_RESULTS,
  );

  if (blendedResults.length === 0) {
    const diagnostics = [
      ...buildDiagnostics(googleAttempts, googleResults.length, "google"),
      ...buildDiagnostics(duckDuckGoAttempts, alternateResults.length, "duckduckgo"),
    ];
    throw new Error(`No extractable supplemental search evidence was available. ${diagnostics.join(" | ")}`);
  }

  const source: SearchFallbackSource = googleResults.length > 0 ? "google-search-snippets" : "alternate-search-snippets";
  const provider: SearchFallbackProvider = googleResults.length > 0 ? "google" : "duckduckgo";

  return {
    query,
    source,
    provider,
    summary: buildSummary(query, blendedResults),
    aiOverview: [],
    results: blendedResults,
    extractedAt: Date.now(),
    diagnostics: [
      ...buildDiagnostics(googleAttempts, googleResults.length, "google"),
      ...buildDiagnostics(duckDuckGoAttempts, alternateResults.length, "duckduckgo"),
    ],
  };
}
