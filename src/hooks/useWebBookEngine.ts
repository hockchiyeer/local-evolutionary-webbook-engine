import { useState, useEffect } from 'react';
import type { 
  Chapter,
  ChapterFeedback,
  FeedbackIssueTag,
  FeedbackSignal,
  ProviderRunSummary,
  RewardProfile,
  RewardWeightProfile,
  SearchExecutionMode,
  SearchSourceConfig,
  SearchSourceKey,
  SourceReference,
  WebBook,
  WebBookFeedback,
  WebPageGenotype,
  EvolutionState,
  WebBookRunContext,
} from '../types';
import type { SearchBatchProvider, SearchProgressUpdate } from '../services/evolutionService';

export const normalizeSourceReference = (source: SourceReference) => {
  if (typeof source === 'string') {
    return {
      title: source,
      url: source,
    };
  }

  return {
    title: source.title || source.url,
    url: source.url,
  };
};

export const splitChapterContent = (content: string) => {
  const sentences = content
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);

  const lead = sentences.slice(0, 3).join(' ');
  const remainder = sentences.slice(3).join(' ');

  return {
    lead: lead || content,
    remainder,
  };
};

export const SOURCE_PORTAL_STORAGE_KEY = "webbook_source_config";
export const WEBBOOK_HISTORY_STORAGE_KEY = "webbook_history";

export const DEFAULT_SOURCE_CONFIG: SearchSourceConfig = {
  sources: {
    wikipedia: true,
    openlibrary: true,
    crossref: true,
    duckduckgo: true,
    google: true,
    bing: true,
  },
  manualUrls: [],
  executionMode: "sequential",
};

export const DEFAULT_REWARD_WEIGHTS: RewardWeightProfile = {
  relevance: 1,
  coverage: 1,
  authority: 1,
  evidenceDensity: 1,
  diversity: 1,
  structure: 1,
  coherence: 1,
  titleSpecificity: 1,
  antiRedundancy: 1,
};

const FEEDBACK_TAG_SET = new Set<FeedbackIssueTag>([
  "too_generic",
  "repetitive",
  "weak_evidence",
  "unclear_titles",
  "wrong_structure",
  "clear_structure",
  "strong_evidence",
  "insightful_synthesis",
]);

const POSITIVE_FEEDBACK_TAGS = new Set<FeedbackIssueTag>([
  "clear_structure",
  "strong_evidence",
  "insightful_synthesis",
]);

const FEEDBACK_WEIGHT_IMPACT: Record<FeedbackIssueTag, Partial<RewardWeightProfile>> = {
  too_generic: {
    relevance: 0.08,
    coverage: 0.04,
    titleSpecificity: 0.1,
  },
  repetitive: {
    diversity: 0.12,
    antiRedundancy: 0.12,
    coherence: 0.03,
  },
  weak_evidence: {
    authority: 0.1,
    evidenceDensity: 0.12,
    structure: 0.04,
  },
  unclear_titles: {
    titleSpecificity: 0.14,
    relevance: 0.05,
  },
  wrong_structure: {
    structure: 0.12,
    coherence: 0.08,
  },
  clear_structure: {
    structure: 0.05,
    coherence: 0.05,
  },
  strong_evidence: {
    authority: 0.05,
    evidenceDensity: 0.06,
  },
  insightful_synthesis: {
    coherence: 0.08,
    diversity: 0.04,
    relevance: 0.03,
  },
};

const clampRewardWeight = (value: number) => Number(Math.min(1.35, Math.max(0.82, value)).toFixed(3));

const cloneRewardWeights = (): RewardWeightProfile => ({ ...DEFAULT_REWARD_WEIGHTS });
const normalizeCustomTagValue = (value: string) => value.trim().replace(/\s+/g, " ").slice(0, 48);
const customTagKey = (value: string) => normalizeCustomTagValue(value).toLowerCase();

const isFeedbackSignal = (value: unknown): value is FeedbackSignal => value === "positive" || value === "negative";

const isFeedbackIssueTag = (value: unknown): value is FeedbackIssueTag => typeof value === "string" && FEEDBACK_TAG_SET.has(value as FeedbackIssueTag);

const normalizeIssueTags = (value: unknown): FeedbackIssueTag[] => {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.filter(isFeedbackIssueTag)));
};

const normalizeCustomTags = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];

  const seen = new Set<string>();
  const normalizedTags: string[] = [];

  value.forEach((entry) => {
    if (typeof entry !== "string") {
      return;
    }

    const normalized = normalizeCustomTagValue(entry);
    const key = customTagKey(normalized);
    if (!normalized || seen.has(key)) {
      return;
    }

    seen.add(key);
    normalizedTags.push(normalized);
  });

  return normalizedTags.slice(0, 12);
};

const applyRewardDelta = (
  weights: RewardWeightProfile,
  deltas: Partial<RewardWeightProfile>,
) => {
  Object.entries(deltas).forEach(([metric, delta]) => {
    const key = metric as keyof RewardWeightProfile;
    weights[key] += Number(delta || 0);
  });
};

const inferCustomTagImpact = (tag: string): Partial<RewardWeightProfile> => {
  const normalized = customTagKey(tag);
  const impact: Partial<RewardWeightProfile> = {};

  const addImpact = (key: keyof RewardWeightProfile, delta: number) => {
    impact[key] = Number((impact[key] || 0) + delta);
  };

  if (/(generic|vague|broad|surface|shallow)/.test(normalized)) {
    addImpact("relevance", 0.08);
    addImpact("coverage", 0.04);
    addImpact("titleSpecificity", 0.08);
  }
  if (/(repeat|repetitive|redundan|duplicate|loop|same)/.test(normalized)) {
    addImpact("diversity", 0.12);
    addImpact("antiRedundancy", 0.12);
  }
  if (/(evidence|source|citation|reference|unsupported|hallucin|accuracy|factual)/.test(normalized)) {
    addImpact("authority", 0.1);
    addImpact("evidenceDensity", 0.12);
  }
  if (/(title|heading|headline|naming|name)/.test(normalized)) {
    addImpact("titleSpecificity", 0.14);
    addImpact("relevance", 0.04);
  }
  if (/(structure|flow|order|sequence|logic|organization|organisation|outline)/.test(normalized)) {
    addImpact("structure", 0.12);
    addImpact("coherence", 0.08);
  }
  if (/(synthesis|insight|connection|compare|comparison|causal|context|analysis)/.test(normalized)) {
    addImpact("coherence", 0.08);
    addImpact("diversity", 0.05);
  }
  if (/(detail|depth|specific|granular|nuance)/.test(normalized)) {
    addImpact("coverage", 0.05);
    addImpact("evidenceDensity", 0.07);
  }

  return impact;
};

const createEmptyChapterFeedback = (): ChapterFeedback => ({
  signal: null,
  issueTags: [],
  customTags: [],
  updatedAt: null,
});

const normalizeChapterFeedback = (value: unknown): ChapterFeedback => {
  if (!value || typeof value !== "object") {
    return createEmptyChapterFeedback();
  }

  const candidate = value as Partial<ChapterFeedback>;
  return {
    signal: isFeedbackSignal(candidate.signal) ? candidate.signal : null,
    issueTags: normalizeIssueTags(candidate.issueTags),
    customTags: normalizeCustomTags(candidate.customTags),
    updatedAt: typeof candidate.updatedAt === "number" ? candidate.updatedAt : null,
  };
};

const normalizeChapter = (chapter: Chapter | Record<string, unknown>, bookId: string, index: number): Chapter => {
  const candidate = chapter as Chapter;
  const normalizedSourceUrls = Array.isArray(candidate.sourceUrls)
    ? candidate.sourceUrls.map(normalizeSourceReference)
    : [];
  const normalizedSources = Array.isArray(candidate.sources)
    ? candidate.sources.map(normalizeSourceReference)
    : normalizedSourceUrls;

  return {
    ...candidate,
    id: candidate.id || `${bookId}-chapter-${index + 1}`,
    sources: normalizedSources,
    sourceUrls: normalizedSourceUrls,
    definitions: Array.isArray(candidate.definitions) ? candidate.definitions : [],
    subTopics: Array.isArray(candidate.subTopics) ? candidate.subTopics : [],
  };
};

const createEmptyWebBookFeedback = (chapters: Chapter[]): WebBookFeedback => ({
  bookSignal: null,
  issueTags: [],
  customTags: [],
  chapterFeedback: Object.fromEntries(chapters.map((chapter, index) => [chapter.id || `chapter-${index + 1}`, createEmptyChapterFeedback()])),
  updatedAt: null,
});

const normalizeRunContext = (value: unknown): WebBookRunContext | undefined => {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const candidate = value as Partial<WebBookRunContext>;
  const rawStatuses = Array.isArray(candidate.providerStatuses) ? candidate.providerStatuses : [];
  const providerStatuses: ProviderRunSummary[] = rawStatuses.map((status) => ({
    provider: String(status.provider || ""),
    status: status.status === "running" || status.status === "complete" || status.status === "error" ? status.status : "queued",
    resultCount: Number(status.resultCount || 0),
    frontierCount: Number(status.frontierCount || 0),
    durationMs: typeof status.durationMs === "number" ? status.durationMs : null,
    error: typeof status.error === "string" ? status.error : null,
  }));

  return {
    sourceConfig: sanitizeSourceConfig(candidate.sourceConfig),
    bestFitness: Number(candidate.bestFitness || 0),
    providerStatuses,
    rewardProfileSnapshot: normalizeRewardProfile(candidate.rewardProfileSnapshot),
  };
};

export const normalizeRewardProfile = (value: unknown): RewardProfile => {
  if (!value || typeof value !== "object") {
    return {
      sampleSize: 0,
      positiveSignals: 0,
      negativeSignals: 0,
      dominantIssues: [],
      dominantCustomTags: [],
      weights: cloneRewardWeights(),
      updatedAt: null,
    };
  }

  const candidate = value as Partial<RewardProfile>;
  const rawWeights = (candidate.weights || {}) as Partial<RewardWeightProfile>;
  return {
    sampleSize: Number(candidate.sampleSize || 0),
    positiveSignals: Number(candidate.positiveSignals || 0),
    negativeSignals: Number(candidate.negativeSignals || 0),
    dominantIssues: normalizeIssueTags(candidate.dominantIssues).slice(0, 3),
    dominantCustomTags: normalizeCustomTags(candidate.dominantCustomTags).slice(0, 4),
    weights: {
      relevance: clampRewardWeight(Number(rawWeights.relevance || 1)),
      coverage: clampRewardWeight(Number(rawWeights.coverage || 1)),
      authority: clampRewardWeight(Number(rawWeights.authority || 1)),
      evidenceDensity: clampRewardWeight(Number(rawWeights.evidenceDensity || 1)),
      diversity: clampRewardWeight(Number(rawWeights.diversity || 1)),
      structure: clampRewardWeight(Number(rawWeights.structure || 1)),
      coherence: clampRewardWeight(Number(rawWeights.coherence || 1)),
      titleSpecificity: clampRewardWeight(Number(rawWeights.titleSpecificity || 1)),
      antiRedundancy: clampRewardWeight(Number(rawWeights.antiRedundancy || 1)),
    },
    updatedAt: typeof candidate.updatedAt === "number" ? candidate.updatedAt : null,
  };
};

export const normalizeWebBook = (value: WebBook | Record<string, unknown>): WebBook => {
  const candidate = value as WebBook;
  const bookId = String(candidate.id || `book-${candidate.timestamp || Date.now()}`);
  const normalizedChapters = Array.isArray(candidate.chapters)
    ? candidate.chapters.map((chapter, index) => normalizeChapter(chapter, bookId, index))
    : [];
  const fallbackFeedback = createEmptyWebBookFeedback(normalizedChapters);
  const rawFeedback = candidate.feedback && typeof candidate.feedback === "object"
    ? candidate.feedback
    : undefined;
  const rawChapterFeedback = rawFeedback?.chapterFeedback && typeof rawFeedback.chapterFeedback === "object"
    ? rawFeedback.chapterFeedback
    : {};

  const chapterFeedback = Object.fromEntries(
    normalizedChapters.map((chapter, index) => {
      const rawMatch = rawChapterFeedback?.[chapter.id || ""]
        || rawChapterFeedback?.[String(index)]
        || rawChapterFeedback?.[chapter.title];
      return [chapter.id || `${bookId}-chapter-${index + 1}`, normalizeChapterFeedback(rawMatch)];
    }),
  );

  return {
    ...candidate,
    id: bookId,
    topic: String(candidate.topic || ""),
    chapters: normalizedChapters,
    timestamp: Number(candidate.timestamp || Date.now()),
    feedback: {
      bookSignal: rawFeedback && isFeedbackSignal(rawFeedback.bookSignal) ? rawFeedback.bookSignal : fallbackFeedback.bookSignal,
      issueTags: rawFeedback ? normalizeIssueTags(rawFeedback.issueTags) : [],
      customTags: rawFeedback ? normalizeCustomTags(rawFeedback.customTags) : [],
      chapterFeedback,
      updatedAt: rawFeedback && typeof rawFeedback.updatedAt === "number" ? rawFeedback.updatedAt : null,
    },
    runContext: normalizeRunContext(candidate.runContext),
  };
};

export const buildRewardProfileFromHistory = (history: WebBook[]): RewardProfile => {
  const weights = cloneRewardWeights();
  const issueCounts = new Map<FeedbackIssueTag, number>();
  const customTagCounts = new Map<string, { label: string; count: number }>();
  let sampleSize = 0;
  let positiveSignals = 0;
  let negativeSignals = 0;
  let latestUpdatedAt: number | null = null;

  history.forEach((book) => {
    const normalizedBook = normalizeWebBook(book);
    const feedback = normalizedBook.feedback;
    const chapterFeedbackEntries = Object.values(feedback?.chapterFeedback || {});
    const feedbackSignals = [
      feedback?.bookSignal,
      ...chapterFeedbackEntries.map((entry) => entry.signal),
    ].filter(isFeedbackSignal);
    const allIssueTags = [
      ...(feedback?.issueTags || []),
      ...chapterFeedbackEntries.flatMap((entry) => entry.issueTags),
    ];
    const allCustomTags = [
      ...(feedback?.customTags || []),
      ...chapterFeedbackEntries.flatMap((entry) => entry.customTags),
    ];
    const uniqueIssueTags = Array.from(new Set(allIssueTags));
    const uniqueCustomTags = normalizeCustomTags(allCustomTags);
    const hasSignal = feedbackSignals.length > 0;
    const hasIssues = uniqueIssueTags.length > 0 || uniqueCustomTags.length > 0;

    if (!hasSignal && !hasIssues) {
      return;
    }

    sampleSize += 1;
    const chapterNegativeCount = chapterFeedbackEntries.filter((entry) => entry.signal === "negative").length;
    const chapterPositiveCount = chapterFeedbackEntries.filter((entry) => entry.signal === "positive").length;

    positiveSignals += feedbackSignals.filter((signal) => signal === "positive").length;
    negativeSignals += feedbackSignals.filter((signal) => signal === "negative").length;

    uniqueIssueTags.forEach((tag) => {
      issueCounts.set(tag, (issueCounts.get(tag) || 0) + 1);
      applyRewardDelta(weights, FEEDBACK_WEIGHT_IMPACT[tag]);
    });

    uniqueCustomTags.forEach((tag) => {
      const normalizedKey = customTagKey(tag);
      const current = customTagCounts.get(normalizedKey);
      if (current) {
        current.count += 1;
      } else {
        customTagCounts.set(normalizedKey, { label: tag, count: 1 });
      }
      applyRewardDelta(weights, inferCustomTagImpact(tag));
    });

    if (feedback?.bookSignal === "positive") {
      weights.coherence += 0.03;
      weights.evidenceDensity += 0.02;
    }
    if (feedback?.bookSignal === "negative") {
      weights.relevance += 0.04;
      weights.structure += 0.04;
      weights.titleSpecificity += 0.03;
    }

    if (chapterNegativeCount > 0) {
      weights.antiRedundancy += chapterNegativeCount * 0.025;
      weights.diversity += chapterNegativeCount * 0.02;
    }
    if (chapterPositiveCount > 0) {
      weights.coherence += chapterPositiveCount * 0.015;
    }

    latestUpdatedAt = Math.max(
      latestUpdatedAt ?? 0,
      feedback?.updatedAt || 0,
      ...chapterFeedbackEntries.map((entry) => entry.updatedAt || 0),
    ) || latestUpdatedAt;
  });

  const dominantIssues = Array.from(issueCounts.entries())
    .sort((left, right) => {
      if (right[1] !== left[1]) {
        return right[1] - left[1];
      }

      const leftPositive = POSITIVE_FEEDBACK_TAGS.has(left[0]) ? 1 : 0;
      const rightPositive = POSITIVE_FEEDBACK_TAGS.has(right[0]) ? 1 : 0;
      return leftPositive - rightPositive;
    })
    .slice(0, 3)
    .map(([tag]) => tag);
  const dominantCustomTags = Array.from(customTagCounts.values())
    .sort((left, right) => right.count - left.count)
    .slice(0, 4)
    .map((entry) => entry.label);

  return {
    sampleSize,
    positiveSignals,
    negativeSignals,
    dominantIssues,
    dominantCustomTags,
    weights: {
      relevance: clampRewardWeight(weights.relevance),
      coverage: clampRewardWeight(weights.coverage),
      authority: clampRewardWeight(weights.authority),
      evidenceDensity: clampRewardWeight(weights.evidenceDensity),
      diversity: clampRewardWeight(weights.diversity),
      structure: clampRewardWeight(weights.structure),
      coherence: clampRewardWeight(weights.coherence),
      titleSpecificity: clampRewardWeight(weights.titleSpecificity),
      antiRedundancy: clampRewardWeight(weights.antiRedundancy),
    },
    updatedAt: latestUpdatedAt,
  };
};

const hasPersistableFeedback = (book: WebBook) => {
  const feedback = book.feedback;
  if (!feedback) {
    return false;
  }

  if (feedback.bookSignal || feedback.issueTags.length > 0 || feedback.customTags.length > 0) {
    return true;
  }

  return Object.values(feedback.chapterFeedback).some(
    (entry) => entry.signal || entry.issueTags.length > 0 || entry.customTags.length > 0,
  );
};

export const EXECUTION_MODE_CARDS: Array<{
  key: SearchExecutionMode;
  label: string;
  description: string;
}> = [
  {
    key: "sequential",
    label: "SEQUENTIAL",
    description: "Recommended for reliability. Runs one provider at a time with clearer progress and lower system pressure.",
  },
  {
    key: "parallel",
    label: "PARALLEL",
    description: "Runs providers together for faster intake on stronger hardware and more stable network conditions.",
  },
];

export const SOURCE_PORTAL_CARDS: Array<{
  key: SearchSourceKey;
  label: string;
  category: string;
  description: string;
  usage: string;
}> = [
  {
    key: "wikipedia",
    label: "Wikipedia",
    category: "Encyclopedic anchor",
    description: "Structured topic lookup with page extracts that give the frontier a grounded starting frame.",
    usage: "Best for entities, timelines, historical framing, and broad conceptual orientation.",
  },
  {
    key: "openlibrary",
    label: "Open Library",
    category: "Book metadata",
    description: "Public book, author, and subject metadata pulled from Open Library's official web APIs.",
    usage: "Useful when the topic has a strong book, author, subject, or publishing footprint.",
  },
  {
    key: "crossref",
    label: "Crossref",
    category: "Scholarly metadata",
    description: "Official Crossref metadata retrieval for research-heavy topics, abstracts, journals, and proceedings.",
    usage: "Strong for academic, technical, standards, and evidence-oriented queries.",
  },
  {
    key: "duckduckgo",
    label: "DuckDuckGo",
    category: "Public web",
    description: "Broad public-web discovery with lightweight snippet extraction and later page-excerpt enrichment.",
    usage: "Good for widening coverage across articles, explainers, blogs, and public websites.",
  },
  {
    key: "google",
    label: "Google",
    category: "Public web",
    description: "Additional public-web coverage when directly accessible from the local runtime environment.",
    usage: "Useful when you want extra ranking diversity and more candidate landing pages.",
  },
  {
    key: "bing",
    label: "Bing",
    category: "Public web",
    description: "Alternative ranking and source discovery pass from another search engine index.",
    usage: "Helpful for a second web-search perspective and source diversity.",
  },
];

export const normalizeManualUrl = (value: string) => {
  const trimmed = value.trim().replace(/[),.;]+$/g, "");
  if (!trimmed) return "";

  try {
    const candidate = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed) ? trimmed : `https://${trimmed}`;
    const parsed = new URL(candidate);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      return "";
    }
    return parsed.toString();
  } catch {
    return "";
  }
};

export const extractManualUrls = (value: string) => {
  const parts = value.split(/[\s,]+/).map(normalizeManualUrl).filter(Boolean);
  return Array.from(new Set(parts));
};

export const sanitizeSourceConfig = (value: unknown): SearchSourceConfig => {
  if (!value || typeof value !== "object") {
    return DEFAULT_SOURCE_CONFIG;
  }

  const candidate = value as Partial<SearchSourceConfig>;
  const rawSources = candidate.sources;
  const manualUrls = Array.isArray(candidate.manualUrls)
    ? Array.from(new Set(candidate.manualUrls.map((url) => normalizeManualUrl(String(url))).filter(Boolean))).slice(0, 12)
    : [];
  const executionMode = candidate.executionMode === "parallel" ? "parallel" : DEFAULT_SOURCE_CONFIG.executionMode;

  return {
    sources: {
      wikipedia: typeof rawSources?.wikipedia === "boolean" ? rawSources.wikipedia : DEFAULT_SOURCE_CONFIG.sources.wikipedia,
      openlibrary: typeof rawSources?.openlibrary === "boolean" ? rawSources.openlibrary : DEFAULT_SOURCE_CONFIG.sources.openlibrary,
      crossref: typeof rawSources?.crossref === "boolean" ? rawSources.crossref : DEFAULT_SOURCE_CONFIG.sources.crossref,
      duckduckgo: typeof rawSources?.duckduckgo === "boolean" ? rawSources.duckduckgo : DEFAULT_SOURCE_CONFIG.sources.duckduckgo,
      google: typeof rawSources?.google === "boolean" ? rawSources.google : DEFAULT_SOURCE_CONFIG.sources.google,
      bing: typeof rawSources?.bing === "boolean" ? rawSources.bing : DEFAULT_SOURCE_CONFIG.sources.bing,
    },
    manualUrls,
    executionMode,
  };
};

const fallbackProviderDescriptor = (provider: string) => ({
  label: provider.charAt(0).toUpperCase() + provider.slice(1),
  category: "Supplemental",
  description: "Auxiliary stage generated by the local engine.",
});

export const getProviderDescriptor = (provider: string) => {
  const builtInCard = SOURCE_PORTAL_CARDS.find((card) => card.key === provider);
  if (builtInCard) {
    return {
      label: builtInCard.label,
      category: builtInCard.category,
      description: builtInCard.description,
    };
  }

  switch (provider) {
    case "manual":
      return {
        label: "Manual URLs",
        category: "Direct pages",
        description: "User-supplied pages fetched directly into the search frontier.",
      };
    case "local-synthesis":
      return {
        label: "Local Synthesis",
        category: "Fallback layer",
        description: "Adaptive local fallback used when live retrieval yields no viable frontier.",
      };
    case "search-fallback":
      return {
        label: "Live Search Fallback",
        category: "Supplemental",
        description: "Query-variant Google and DuckDuckGo evidence blended in when the frontier is thin or blocked.",
      };
    default:
      return fallbackProviderDescriptor(provider);
  }
};

export interface ArtifactProviderStatus {
  provider: SearchBatchProvider;
  label: string;
  category: string;
  description: string;
  status: 'queued' | 'running' | 'complete' | 'error';
  resultCount: number;
  frontierCount: number;
  durationMs: number | null;
  error: string | null;
}

export interface ArtifactsState {
  status: EvolutionState['status'] | 'error';
  query: string;
  sourceConfig: SearchSourceConfig;
  searchResults: WebPageGenotype[];
  evolvedPopulation: WebPageGenotype[];
  assembledBook: WebBook | null;
  startedAt: number | null;
  updatedAt: number | null;
  error: string | null;
  providerStatuses: ArtifactProviderStatus[];
}

export const EMPTY_ARTIFACTS: ArtifactsState = {
  status: 'idle',
  query: "",
  sourceConfig: DEFAULT_SOURCE_CONFIG,
  searchResults: [],
  evolvedPopulation: [],
  assembledBook: null,
  startedAt: null,
  updatedAt: null,
  error: null,
  providerStatuses: [],
};

export const getProviderLabel = (provider: string) => getProviderDescriptor(provider).label;

export const buildArtifactProviderStatuses = (config: SearchSourceConfig): ArtifactProviderStatus[] => {
  const statuses = SOURCE_PORTAL_CARDS
    .filter((card) => config.sources[card.key])
    .map((card, index) => ({
      provider: card.key as SearchBatchProvider,
      label: card.label,
      category: card.category,
      description: card.description,
      status: config.executionMode === 'parallel'
        ? 'running' as const
        : (index === 0 ? 'running' as const : 'queued' as const),
      resultCount: 0,
      frontierCount: 0,
      durationMs: null,
      error: null,
    }));

  if (config.manualUrls.length > 0) {
    const descriptor = getProviderDescriptor("manual");
    statuses.push({
      provider: 'manual',
      label: descriptor.label,
      category: descriptor.category,
      description: descriptor.description,
      status: config.executionMode === 'parallel'
        ? 'running'
        : (statuses.length === 0 ? 'running' : 'queued'),
      resultCount: 0,
      frontierCount: 0,
      durationMs: null,
      error: null,
    });
  }

  return statuses;
};

export const applySearchProgressToStatuses = (
  statuses: ArtifactProviderStatus[],
  progress: SearchProgressUpdate,
): ArtifactProviderStatus[] => {
  const nextStatuses = [...statuses];
  const providerIndex = nextStatuses.findIndex((status) => status.provider === progress.provider);

  if (progress.phase === 'started') {
    if (providerIndex >= 0) {
      nextStatuses[providerIndex] = {
        ...nextStatuses[providerIndex],
        status: 'running',
        frontierCount: progress.mergedResults.length,
        error: null,
      };
    } else {
      const descriptor = getProviderDescriptor(progress.provider);
      nextStatuses.push({
        provider: progress.provider,
        label: descriptor.label,
        category: descriptor.category,
        description: descriptor.description,
        status: 'running',
        resultCount: 0,
        frontierCount: progress.mergedResults.length,
        durationMs: progress.durationMs ?? null,
        error: null,
      });
    }
    return nextStatuses;
  }

  if (providerIndex >= 0) {
    nextStatuses[providerIndex] = {
      ...nextStatuses[providerIndex],
      status: progress.error ? 'error' : 'complete',
      resultCount: progress.batchResults.length,
      frontierCount: progress.mergedResults.length,
      durationMs: progress.durationMs ?? nextStatuses[providerIndex].durationMs,
      error: progress.error || null,
    };
  } else {
    const descriptor = getProviderDescriptor(progress.provider);
    nextStatuses.push({
      provider: progress.provider,
      label: descriptor.label,
      category: descriptor.category,
      description: descriptor.description,
      status: progress.error ? 'error' : 'complete',
      resultCount: progress.batchResults.length,
      frontierCount: progress.mergedResults.length,
      durationMs: progress.durationMs ?? null,
      error: progress.error || null,
    });
  }

  if (!nextStatuses.some((status) => status.status === 'running')) {
    const nextQueuedIndex = nextStatuses.findIndex((status) => status.status === 'queued');
    if (nextQueuedIndex >= 0) {
      nextStatuses[nextQueuedIndex] = {
        ...nextStatuses[nextQueuedIndex],
        status: 'running',
      };
    }
  }

  return nextStatuses;
};

export function useWebBookEngine() {
  const [query, setQuery] = useState('');
  const [sourceConfig, setSourceConfig] = useState<SearchSourceConfig>(DEFAULT_SOURCE_CONFIG);
  const [manualSourceInput, setManualSourceInput] = useState('');
  const [state, setState] = useState<EvolutionState>({
    generation: 0,
    population: [],
    bestFitness: 0,
    status: 'idle'
  });
  const [webBook, setWebBook] = useState<WebBook | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [history, setHistory] = useState<WebBook[]>([]);
  const [artifacts, setArtifacts] = useState<ArtifactsState>(EMPTY_ARTIFACTS);
  const [persistentRewardProfile, setPersistentRewardProfile] = useState<RewardProfile | null>(null);
  const [hasLoadedPersistentRewardProfile, setHasLoadedPersistentRewardProfile] = useState(false);
  const [hasBootstrappedPersistentFeedback, setHasBootstrappedPersistentFeedback] = useState(false);
  const localRewardProfile = buildRewardProfileFromHistory(history);
  const rewardProfile = persistentRewardProfile && persistentRewardProfile.sampleSize > 0
    ? persistentRewardProfile
    : localRewardProfile;

  // Load history & config from localStorage
  useEffect(() => {
    const savedHistory = localStorage.getItem(WEBBOOK_HISTORY_STORAGE_KEY);
    if (savedHistory) {
      try {
        const parsedHistory = JSON.parse(savedHistory);
        if (Array.isArray(parsedHistory)) {
          setHistory(parsedHistory.map((item) => normalizeWebBook(item)));
        }
      } catch (e) {
        console.error("Failed to parse history", e);
      }
    }
    const savedSourceConfig = localStorage.getItem(SOURCE_PORTAL_STORAGE_KEY);
    if (savedSourceConfig) {
      try {
        setSourceConfig(sanitizeSourceConfig(JSON.parse(savedSourceConfig)));
      } catch (e) { }
    }
  }, []);

  // Save changes
  useEffect(() => {
    localStorage.setItem(WEBBOOK_HISTORY_STORAGE_KEY, JSON.stringify(history));
  }, [history]);

  useEffect(() => {
    localStorage.setItem(SOURCE_PORTAL_STORAGE_KEY, JSON.stringify(sourceConfig));
  }, [sourceConfig]);

  useEffect(() => {
    let cancelled = false;

    const loadPersistentLearningProfile = async () => {
      try {
        const { getPersistentRewardProfile } = await import('../services/evolutionService');
        const response = await getPersistentRewardProfile();
        if (cancelled) return;
        setPersistentRewardProfile(normalizeRewardProfile(response.rewardProfile));
      } catch (loadError) {
        console.error("Failed to load persistent learning profile", loadError);
      } finally {
        if (!cancelled) {
          setHasLoadedPersistentRewardProfile(true);
        }
      }
    };

    void loadPersistentLearningProfile();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!hasLoadedPersistentRewardProfile || hasBootstrappedPersistentFeedback) {
      return;
    }

    const ratedBooks = history.filter(hasPersistableFeedback);
    if (ratedBooks.length === 0) {
      setHasBootstrappedPersistentFeedback(true);
      return;
    }

    if (persistentRewardProfile && persistentRewardProfile.sampleSize > 0) {
      setHasBootstrappedPersistentFeedback(true);
      return;
    }

    let cancelled = false;

    const bootstrapPersistentLearning = async () => {
      try {
        const { bootstrapPersistentFeedback } = await import('../services/evolutionService');
        const response = await bootstrapPersistentFeedback(ratedBooks);
        if (cancelled) return;
        setPersistentRewardProfile(normalizeRewardProfile(response.rewardProfile));
      } catch (bootstrapError) {
        console.error("Failed to bootstrap persistent learning profile", bootstrapError);
      } finally {
        if (!cancelled) {
          setHasBootstrappedPersistentFeedback(true);
        }
      }
    };

    void bootstrapPersistentLearning();

    return () => {
      cancelled = true;
    };
  }, [hasBootstrappedPersistentFeedback, hasLoadedPersistentRewardProfile, history, persistentRewardProfile]);

  const persistFeedbackSnapshot = async (book: WebBook) => {
    if (!hasPersistableFeedback(book)) {
      return;
    }

    try {
      const { savePersistentFeedback } = await import('../services/evolutionService');
      const response = await savePersistentFeedback(book);
      setPersistentRewardProfile(normalizeRewardProfile(response.rewardProfile));
      setHasLoadedPersistentRewardProfile(true);
      setHasBootstrappedPersistentFeedback(true);
    } catch (persistError) {
      console.error("Failed to persist feedback snapshot", persistError);
      setNotice("Feedback was saved locally, but the shared backend learning store could not be updated.");
    }
  };

  const applyFeedbackMutation = (bookId: string, mutate: (book: WebBook) => WebBook) => {
    const sourceBook = webBook?.id === bookId
      ? normalizeWebBook(webBook)
      : history.find((item) => item.id === bookId);

    if (!sourceBook) {
      return;
    }

    const nextBook = normalizeWebBook(mutate(normalizeWebBook(sourceBook)));

    setHistory((currentHistory) =>
      currentHistory.map((item) => (
        item.id === bookId
          ? nextBook
          : item
      )),
    );

    if (webBook?.id === bookId) {
      setWebBook(nextBook);
    }

    setArtifacts((currentArtifacts) => {
      if (!currentArtifacts.assembledBook || currentArtifacts.assembledBook.id !== bookId) {
        return currentArtifacts;
      }

      return {
        ...currentArtifacts,
        assembledBook: nextBook,
      };
    });

    void persistFeedbackSnapshot(nextBook);
  };

  const updateWebBookFeedback = (
    bookId: string,
    patch: Partial<Pick<WebBookFeedback, "bookSignal" | "issueTags" | "customTags">>,
  ) => {
    applyFeedbackMutation(bookId, (book) => {
      const nextIssueTags = patch.issueTags ? Array.from(new Set(patch.issueTags)) : book.feedback?.issueTags || [];
      const nextCustomTags = patch.customTags ? normalizeCustomTags(patch.customTags) : book.feedback?.customTags || [];
      return {
        ...book,
        feedback: {
          ...(book.feedback || createEmptyWebBookFeedback(book.chapters)),
          bookSignal: patch.bookSignal === undefined ? (book.feedback?.bookSignal || null) : patch.bookSignal,
          issueTags: nextIssueTags,
          customTags: nextCustomTags,
          updatedAt: Date.now(),
        },
      };
    });
  };

  const updateChapterFeedback = (
    bookId: string,
    chapterId: string,
    patch: Partial<ChapterFeedback>,
  ) => {
    applyFeedbackMutation(bookId, (book) => {
      const feedback = book.feedback || createEmptyWebBookFeedback(book.chapters);
      const currentChapterFeedback = normalizeChapterFeedback(feedback.chapterFeedback[chapterId]);
      return {
        ...book,
        feedback: {
          ...feedback,
          chapterFeedback: {
            ...feedback.chapterFeedback,
            [chapterId]: {
              signal: patch.signal === undefined ? currentChapterFeedback.signal : patch.signal,
              issueTags: patch.issueTags ? Array.from(new Set(patch.issueTags)) : currentChapterFeedback.issueTags,
              customTags: patch.customTags ? normalizeCustomTags(patch.customTags) : currentChapterFeedback.customTags,
              updatedAt: Date.now(),
            },
          },
          updatedAt: Date.now(),
        },
      };
    });
  };

  const toggleBuiltInSource = (sourceKey: SearchSourceKey) => {
    setError(null);
    setSourceConfig((current) => ({
      ...current,
      sources: {
        ...current.sources,
        [sourceKey]: !current.sources[sourceKey],
      },
    }));
  };

  const setAllBuiltInSources = (enabled: boolean) => {
    setError(null);
    setSourceConfig((current) => ({
      ...current,
      sources: {
        wikipedia: enabled,
        openlibrary: enabled,
        crossref: enabled,
        duckduckgo: enabled,
        google: enabled,
        bing: enabled,
      },
    }));
  };

  const setExecutionMode = (executionMode: SearchExecutionMode) => {
    setError(null);
    setSourceConfig((current) => ({
      ...current,
      executionMode,
    }));
  };

  const addManualSources = () => {
    const extractedUrls = extractManualUrls(manualSourceInput);
    if (extractedUrls.length === 0) {
      setError("Enter at least one valid manual URL starting with http(s) or a resolvable domain.");
      return;
    }

    setSourceConfig((current) => ({
      ...current,
      manualUrls: Array.from(new Set([...current.manualUrls, ...extractedUrls])).slice(0, 12),
    }));
    setManualSourceInput('');
    setError(null);
  };

  const removeManualSource = (urlToRemove: string) => {
    setError(null);
    setSourceConfig((current) => ({
      ...current,
      manualUrls: current.manualUrls.filter((url) => url !== urlToRemove),
    }));
  };

  const startNewSearch = () => {
    setQuery('');
    setWebBook(null);
    setError(null);
    setNotice(null);
    setArtifacts(EMPTY_ARTIFACTS);
    setState({
      generation: 0,
      population: [],
      bestFitness: 0,
      status: 'idle'
    });
  };

  const viewHistoryItem = (item: WebBook) => {
    const normalizedItem = normalizeWebBook(item);
    const artifactSourceConfig = normalizedItem.runContext?.sourceConfig || sourceConfig;
    setWebBook(normalizedItem);
    setQuery(normalizedItem.topic);
    setArtifacts({
      status: 'complete',
      query: normalizedItem.topic,
      sourceConfig: artifactSourceConfig,
      searchResults: [],
      evolvedPopulation: [],
      assembledBook: normalizedItem,
      startedAt: normalizedItem.timestamp,
      updatedAt: normalizedItem.timestamp,
      error: null,
      providerStatuses: normalizedItem.runContext?.providerStatuses || [],
    });
    setState({
      generation: 3,
      population: [],
      bestFitness: normalizedItem.runContext?.bestFitness || 0,
      status: 'complete'
    });
  };

  const deleteHistoryItem = (id: string) => {
    setHistory(prev => prev.filter(item => item.id !== id));
  };

  const clearAllHistory = () => {
    if (window.confirm("Are you sure you want to delete all search history?")) {
      setHistory([]);
    }
  };

  const runSearch = async () => {
    const trimmedQuery = query.trim();
    if (!trimmedQuery) return;
    
    const enabledBuiltInSourceCount = Object.values(sourceConfig.sources).filter(Boolean).length;
    const hasAnyEnabledSource = enabledBuiltInSourceCount > 0 || sourceConfig.manualUrls.length > 0;
    
    if (!hasAnyEnabledSource) {
      setError("Enable at least one search source or add one manual URL before searching.");
      return;
    }

    const runStartedAt = Date.now();
    const activeRewardProfile = rewardProfile;
    let latestProviderStatuses = buildArtifactProviderStatuses(sourceConfig);
    setState((current) => ({
      ...current,
      status: 'searching',
      generation: 0,
      population: [],
      bestFitness: 0,
    }));
    setWebBook(null);
    setError(null);
    setNotice(
      activeRewardProfile.sampleSize > 0
        ? `Adaptive feedback profile active from ${activeRewardProfile.sampleSize} rated Web-book${activeRewardProfile.sampleSize === 1 ? "" : "s"}.`
        : null,
    );
    setArtifacts({
      status: 'searching',
      query: trimmedQuery,
      sourceConfig,
      searchResults: [],
      evolvedPopulation: [],
      assembledBook: null,
      startedAt: runStartedAt,
      updatedAt: runStartedAt,
      error: null,
      providerStatuses: latestProviderStatuses,
    });

    try {
      const { searchAndExtract, evolve, assembleWebBook } = await import('../services/evolutionService');
      
      const initialPopulation: WebPageGenotype[] = await searchAndExtract(trimmedQuery, sourceConfig, (progress: SearchProgressUpdate) => {
        latestProviderStatuses = applySearchProgressToStatuses(latestProviderStatuses, progress);
        setArtifacts((current) => ({
          ...current,
          status: 'searching',
          searchResults: progress.mergedResults,
          updatedAt: Date.now(),
          providerStatuses: latestProviderStatuses,
        }));
      });
      setArtifacts((current) => ({
        ...current,
        status: 'evolving',
        searchResults: initialPopulation,
        updatedAt: Date.now(),
        providerStatuses: latestProviderStatuses,
      }));
      
      if (initialPopulation.length === 0) {
        throw new Error("No initial data found for the query.");
      }
      
      setState(() => ({
        status: 'evolving',
        generation: 1,
        population: initialPopulation,
        bestFitness: 0,
      }));
      const evolvedPopulation = await evolve(initialPopulation, trimmedQuery, 3, activeRewardProfile);
      const bestFitness = evolvedPopulation.length > 0
        ? Math.max(...evolvedPopulation.map((candidate: WebPageGenotype) => candidate.fitness || 0))
        : 0;
      setArtifacts((current) => ({
        ...current,
        status: 'assembling',
        searchResults: initialPopulation,
        evolvedPopulation,
        updatedAt: Date.now(),
        providerStatuses: latestProviderStatuses,
      }));
      
      setState(() => ({
        status: 'assembling',
        generation: 2,
        population: evolvedPopulation,
        bestFitness,
      }));
      const assembledBook = normalizeWebBook(await assembleWebBook(evolvedPopulation, trimmedQuery, activeRewardProfile));
      const book: WebBook = normalizeWebBook({
        ...assembledBook,
        runContext: {
          sourceConfig,
          bestFitness,
          providerStatuses: latestProviderStatuses,
          rewardProfileSnapshot: activeRewardProfile,
        },
      });
      setArtifacts((current) => ({
        ...current,
        status: 'complete',
        searchResults: initialPopulation,
        evolvedPopulation,
        assembledBook: book,
        updatedAt: Date.now(),
        error: null,
        providerStatuses: latestProviderStatuses,
      }));
      
      setWebBook(book);
      setHistory(prev => [book, ...prev.filter(item => item.id !== book.id)]);
      setState({
        status: 'complete',
        generation: 3,
        population: evolvedPopulation,
        bestFitness,
      });
    } catch (err: any) {
      console.error("Evolution error:", err);
      let message = err.message || "An unexpected error occurred during evolution.";
      if (message.includes("429") || message.includes("quota") || message.includes("RESOURCE_EXHAUSTED")) {
        message = "The search engine is currently applying rate limits. Please wait a minute and try again.";
      }
      setError(message);
      setArtifacts((current) => ({
        ...current,
        status: 'error',
        updatedAt: Date.now(),
        error: message,
      }));
      setState((current) => ({ ...current, status: 'idle' }));
    }
  };

  return {
    query,
    setQuery,
    sourceConfig,
    manualSourceInput,
    setManualSourceInput,
    state,
    webBook,
    history,
    error,
    notice,
    artifacts,
    rewardProfile,
    toggleBuiltInSource,
    setAllBuiltInSources,
    setExecutionMode,
    addManualSources,
    removeManualSource,
    runSearch,
    startNewSearch,
    viewHistoryItem,
    deleteHistoryItem,
    clearAllHistory,
    updateWebBookFeedback,
    updateChapterFeedback,
  };
}
