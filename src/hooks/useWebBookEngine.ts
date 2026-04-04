import { useState, useRef, useEffect } from 'react';
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
    duckduckgo: false,
    google: false,
    bing: false,
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
  description: string;
  usage: string;
}> = [
  {
    key: "wikipedia",
    label: "Wikipedia",
    description: "Primary encyclopedic anchor enriched by local TF-IDF and LSA filtering.",
    usage: "Best for grounded topic overviews, entities, timelines, and reliable conceptual scaffolding.",
  },
  {
    key: "duckduckgo",
    label: "DuckDuckGo",
    description: "Broad public-web discovery with lightweight result extraction.",
    usage: "Use it to widen coverage across blogs, articles, and public websites beyond encyclopedic summaries.",
  },
  {
    key: "google",
    label: "Google",
    description: "Additional web-result coverage when publicly accessible.",
    usage: "Turn it on when you want extra result diversity and broader web discovery for the topic.",
  },
  {
    key: "bing",
    label: "Bing",
    description: "Alternative ranking and source diversity from another engine.",
    usage: "Useful for another ranking perspective when you want more varied public-web sources.",
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
    ? Array.from(new Set(candidate.manualUrls.map((url) => normalizeManualUrl(String(url))).filter(Boolean))).slice(0, 8)
    : [];
  const executionMode = candidate.executionMode === "parallel" ? "parallel" : DEFAULT_SOURCE_CONFIG.executionMode;

  return {
    sources: {
      wikipedia: typeof rawSources?.wikipedia === "boolean" ? rawSources.wikipedia : DEFAULT_SOURCE_CONFIG.sources.wikipedia,
      duckduckgo: typeof rawSources?.duckduckgo === "boolean" ? rawSources.duckduckgo : DEFAULT_SOURCE_CONFIG.sources.duckduckgo,
      google: typeof rawSources?.google === "boolean" ? rawSources.google : DEFAULT_SOURCE_CONFIG.sources.google,
      bing: typeof rawSources?.bing === "boolean" ? rawSources.bing : DEFAULT_SOURCE_CONFIG.sources.bing,
    },
    manualUrls,
    executionMode,
  };
};

export interface ArtifactProviderStatus {
  provider: SearchBatchProvider;
  label: string;
  status: 'queued' | 'running' | 'complete' | 'error';
  resultCount: number;
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

export const getProviderLabel = (provider: string) => {
  switch (provider) {
    case "wikipedia":
      return "Hybrid Wikipedia API";
    case "duckduckgo":
      return "DuckDuckGo";
    case "google":
      return "Google";
    case "bing":
      return "Bing";
    case "manual":
      return "Manual";
    case "local-synthesis":
      return "Local Synthesis";
    default:
      return provider.charAt(0).toUpperCase() + provider.slice(1);
  }
};

export const buildArtifactProviderStatuses = (config: SearchSourceConfig): ArtifactProviderStatus[] => {
  const statuses = SOURCE_PORTAL_CARDS
    .filter((card) => config.sources[card.key])
    .map((card, index) => ({
      provider: card.key as SearchBatchProvider,
      label: card.label,
      status: config.executionMode === 'parallel'
        ? 'running' as const
        : (index === 0 ? 'running' as const : 'queued' as const),
      resultCount: 0,
      error: null,
    }));

  if (config.manualUrls.length > 0) {
    statuses.push({
      provider: 'manual',
      label: 'Manual',
      status: config.executionMode === 'parallel'
        ? 'running'
        : (statuses.length === 0 ? 'running' : 'queued'),
      resultCount: 0,
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
      error: progress.error || null,
    };
  } else {
    nextStatuses.push({
      provider: progress.provider,
      label: getProviderLabel(progress.provider),
      status: progress.error ? 'error' : 'complete',
      resultCount: progress.batchResults.length,
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
      manualUrls: Array.from(new Set([...current.manualUrls, ...extractedUrls])).slice(0, 8),
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
    setState({ ...state, status: 'searching', generation: 0, population: [] });
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
      
      setState(s => ({ ...s, status: 'evolving', population: initialPopulation }));
      const evolvedPopulation = await evolve(initialPopulation, trimmedQuery);
      setArtifacts((current) => ({
        ...current,
        status: 'assembling',
        searchResults: initialPopulation,
        evolvedPopulation,
        updatedAt: Date.now(),
      }));
      
      setState(s => ({ ...s, status: 'assembling', population: evolvedPopulation }));
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
        bestFitness: Math.max(...evolvedPopulation.map((p: any) => p.fitness || 0))
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
      setState({ ...state, status: 'idle' });
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
