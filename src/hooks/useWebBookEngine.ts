import { useState, useEffect } from 'react';
import type { 
  SearchExecutionMode, SearchSourceConfig, SearchSourceKey, 
  SourceReference, WebBook, WebPageGenotype, EvolutionState 
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

export const EXECUTION_MODE_CARDS: Array<{
  key: SearchExecutionMode;
  label: string;
  description: string;
}> = [
  {
    key: "sequential",
    label: "Sequential",
    description: "Recommended for reliability. Runs one provider at a time with clearer progress and lower system pressure.",
  },
  {
    key: "parallel",
    label: "Parallel",
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

  // Load history & config from localStorage
  useEffect(() => {
    const savedHistory = localStorage.getItem('webbook_history');
    if (savedHistory) {
      try {
        setHistory(JSON.parse(savedHistory));
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
    localStorage.setItem('webbook_history', JSON.stringify(history));
  }, [history]);

  useEffect(() => {
    localStorage.setItem(SOURCE_PORTAL_STORAGE_KEY, JSON.stringify(sourceConfig));
  }, [sourceConfig]);

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
    setWebBook(item);
    setQuery(item.topic);
    setArtifacts({
      status: 'complete',
      query: item.topic,
      sourceConfig,
      searchResults: [],
      evolvedPopulation: [],
      assembledBook: item,
      startedAt: item.timestamp,
      updatedAt: item.timestamp,
      error: null,
      providerStatuses: [],
    });
    setState({
      generation: 3,
      population: [],
      bestFitness: 0,
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
    setState((current) => ({
      ...current,
      status: 'searching',
      generation: 0,
      population: [],
      bestFitness: 0,
    }));
    setWebBook(null);
    setError(null);
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
      providerStatuses: buildArtifactProviderStatuses(sourceConfig),
    });

    try {
      const { searchAndExtract, evolve, assembleWebBook } = await import('../services/evolutionService');
      
      const initialPopulation: WebPageGenotype[] = await searchAndExtract(trimmedQuery, sourceConfig, (progress: SearchProgressUpdate) => {
        setArtifacts((current) => ({
          ...current,
          status: 'searching',
          searchResults: progress.mergedResults,
          updatedAt: Date.now(),
          providerStatuses: applySearchProgressToStatuses(current.providerStatuses, progress),
        }));
      });
      setArtifacts((current) => ({
        ...current,
        status: 'evolving',
        searchResults: initialPopulation,
        updatedAt: Date.now(),
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
      const evolvedPopulation = await evolve(initialPopulation, trimmedQuery);
      const bestFitness = evolvedPopulation.length > 0
        ? Math.max(...evolvedPopulation.map((candidate: WebPageGenotype) => candidate.fitness || 0))
        : 0;
      setArtifacts((current) => ({
        ...current,
        status: 'assembling',
        searchResults: initialPopulation,
        evolvedPopulation,
        updatedAt: Date.now(),
      }));
      
      setState(() => ({
        status: 'assembling',
        generation: 2,
        population: evolvedPopulation,
        bestFitness,
      }));
      const book = await assembleWebBook(evolvedPopulation, trimmedQuery);
      setArtifacts((current) => ({
        ...current,
        status: 'complete',
        searchResults: initialPopulation,
        evolvedPopulation,
        assembledBook: book,
        updatedAt: Date.now(),
        error: null,
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
  };
}
