/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */


import React, { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Search, 
  BookOpen, 
  Dna, 
  Cpu, 
  Layers, 
  ChevronRight, 
  ExternalLink, 
  Loader2,
  Info,
  CheckCircle2,
  AlertCircle,
  History,
  Trash2,
  Plus,
  X,
  Clock,
  Image as ImageIcon,
  Download,
  Printer,
  FileText,
  FileCode,
  ChevronDown
} from 'lucide-react';
import { SearchExecutionMode, SearchSourceConfig, SearchSourceKey, SourceReference, WebBook, WebPageGenotype, EvolutionState } from './types';
import { buildChapterRenderPlan } from './utils/webBookRender';
import type { SearchBatchProvider, SearchProgressUpdate } from './services/evolutionService';

const normalizeSourceReference = (source: SourceReference) => {
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

const splitChapterContent = (content: string) => {
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

const SOURCE_PORTAL_STORAGE_KEY = "webbook_source_config";

const DEFAULT_SOURCE_CONFIG: SearchSourceConfig = {
  sources: {
    wikipedia: true,
    duckduckgo: false,
    google: false,
    bing: false,
  },
  manualUrls: [],
  executionMode: "sequential",
};

const EXECUTION_MODE_CARDS: Array<{
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

const SOURCE_PORTAL_CARDS: Array<{
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

const getSourceToggleTitle = (
  source: (typeof SOURCE_PORTAL_CARDS)[number],
  enabled: boolean,
) => `${source.label}: ${source.description} ${source.usage} ${enabled ? 'Toggle off to exclude it from the next search.' : 'Toggle on to include it in the next search.'}`;

type PdfLinkAnnotation = {
  sourcePageNumber: number;
  targetPageNumber: number;
  xRatio: number;
  yRatio: number;
  widthRatio: number;
  heightRatio: number;
};

const PDF_EXPORT_PAGE_WIDTH = 794;
const PDF_EXPORT_PAGE_HEIGHT = 1123;
const PDF_IMAGE_MAX_DIMENSION = 1400;

const wait = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

const getPdfRenderScale = (pageCount: number) => {
  if (pageCount >= 18) return 1.05;
  if (pageCount >= 12) return 1.15;
  if (pageCount >= 8) return 1.3;
  if (pageCount >= 5) return 1.45;
  return 1.6;
};

const normalizeManualUrl = (value: string) => {
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

const extractManualUrls = (value: string) => {
  const parts = value.split(/[\s,]+/).map(normalizeManualUrl).filter(Boolean);
  return Array.from(new Set(parts));
};

const sanitizeSourceConfig = (value: unknown): SearchSourceConfig => {
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

interface ArtifactProviderStatus {
  provider: SearchBatchProvider;
  label: string;
  status: 'queued' | 'running' | 'complete' | 'error';
  resultCount: number;
  error: string | null;
}

interface ArtifactsState {
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

const EMPTY_ARTIFACTS: ArtifactsState = {
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

const formatJson = (value: unknown) => {
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
};

const getProviderLabel = (provider: string) => {
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

const truncateText = (value: string, maxLength = 220) => {
  const trimmed = value.trim();

  if (trimmed.length <= maxLength) {
    return trimmed;
  }

  return `${trimmed.slice(0, maxLength).trimEnd()}...`;
};

type QueryPreviewPlacement = 'top' | 'bottom';

interface QueryPreviewTooltipPosition {
  top: number;
  left: number;
  width: number;
  maxHeight: number;
  arrowLeft: number;
  placement: QueryPreviewPlacement;
  ready: boolean;
}

const QUERY_TOOLTIP_VIEWPORT_MARGIN = 16;
const QUERY_TOOLTIP_GAP = 14;
const QUERY_TOOLTIP_MIN_WIDTH = 260;
const QUERY_TOOLTIP_MAX_WIDTH = 560;
const QUERY_TOOLTIP_MAX_HEIGHT = 360;

const clamp = (value: number, min: number, max: number) => {
  if (max < min) {
    return min;
  }

  return Math.min(Math.max(value, min), max);
};

const buildArtifactProviderStatuses = (config: SearchSourceConfig): ArtifactProviderStatus[] => {
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

const applySearchProgressToStatuses = (
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

const formatElapsedTime = (milliseconds: number) => {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
};

const getArtifactStatusLabel = (status: ArtifactsState['status']) => {
  switch (status) {
    case 'searching':
      return 'Searching Sources';
    case 'evolving':
      return 'Evolving Candidates';
    case 'assembling':
      return 'Assembling Web-book';
    case 'complete':
      return 'Complete';
    case 'error':
      return 'Interrupted';
    default:
      return 'Idle';
  }
};

export default function App() {
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
  const [history, setHistory] = useState<WebBook[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [showArtifacts, setShowArtifacts] = useState(false);
  const [showExportOptions, setShowExportOptions] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const exportDropdownRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const queryTooltipRef = useRef<HTMLDivElement>(null);
  const [isOverflowing, setIsOverflowing] = useState(false);
  const [isHoveringInput, setIsHoveringInput] = useState(false);
  const [queryTooltipPosition, setQueryTooltipPosition] = useState<QueryPreviewTooltipPosition | null>(null);
  const [artifacts, setArtifacts] = useState<ArtifactsState>(EMPTY_ARTIFACTS);
  const [artifactClock, setArtifactClock] = useState(() => Date.now());
  const chapterRenderPlan = webBook ? buildChapterRenderPlan(webBook.chapters) : [];
  const renderableConceptCount = chapterRenderPlan.reduce(
    (total, plan) => total + plan.renderableDefinitions.length,
    0
  );
  const finalDocumentPageNumber = chapterRenderPlan.length > 0
    ? (chapterRenderPlan[chapterRenderPlan.length - 1].analysisPageNumber ?? chapterRenderPlan[chapterRenderPlan.length - 1].titlePageNumber) + 1
    : 3;
  const isBusy = state.status !== 'idle' && state.status !== 'complete';
  const enabledBuiltInSourceCount = Object.values(sourceConfig.sources).filter(Boolean).length;
  const totalEnabledSourceCount = enabledBuiltInSourceCount + sourceConfig.manualUrls.length;
  const hasAnyEnabledSource = enabledBuiltInSourceCount > 0 || sourceConfig.manualUrls.length > 0;
  const activeSourceLabels = SOURCE_PORTAL_CARDS
    .filter((card) => sourceConfig.sources[card.key])
    .map((card) => card.label);
  const sourceSummary = [
    ...activeSourceLabels,
    ...(sourceConfig.manualUrls.length > 0 ? [`${sourceConfig.manualUrls.length} manual`] : []),
    sourceConfig.executionMode === 'parallel' ? 'Parallel mode' : 'Sequential mode',
  ].join(" | ");
  const artifactActiveSourceLabels = SOURCE_PORTAL_CARDS
    .filter((card) => artifacts.sourceConfig.sources[card.key])
    .map((card) => card.label);
  const artifactSourceSummary = [
    ...artifactActiveSourceLabels,
    ...(artifacts.sourceConfig.manualUrls.length > 0 ? [`${artifacts.sourceConfig.manualUrls.length} manual`] : []),
    artifacts.sourceConfig.executionMode === 'parallel' ? 'Parallel mode' : 'Sequential mode',
  ].join(" | ");
  const hasArtifacts = Boolean(
    artifacts.startedAt ||
    artifacts.query ||
    artifacts.searchResults.length ||
    artifacts.evolvedPopulation.length ||
    artifacts.assembledBook ||
    artifacts.error
  );
  const artifactIsActive = artifacts.status === 'searching' || artifacts.status === 'evolving' || artifacts.status === 'assembling';
  const artifactElapsedTime = artifacts.startedAt ? formatElapsedTime(artifactClock - artifacts.startedAt) : '00:00';
  const artifactStatusLabel = getArtifactStatusLabel(artifacts.status);
  const shouldShowQueryTooltip = isOverflowing && isHoveringInput && Boolean(query);
  const artifactProviderSummary = artifacts.searchResults.reduce<Record<string, number>>((summary, result) => {
    const providers = result.searchProviders && result.searchProviders.length > 0
      ? result.searchProviders
      : (result.searchProvider ? [result.searchProvider] : ["unknown"]);

    providers.forEach((provider) => {
      summary[provider] = (summary[provider] || 0) + 1;
    });

    return summary;
  }, {});
  const manualArtifacts = artifacts.searchResults.filter((result) => {
    const providers = result.searchProviders && result.searchProviders.length > 0
      ? result.searchProviders
      : (result.searchProvider ? [result.searchProvider] : []);
    return providers.includes("manual");
  });
  const artifactProviderGroups: [string, WebPageGenotype[]][] = Object.entries(
    artifacts.searchResults.reduce<Record<string, WebPageGenotype[]>>((groups, result) => {
      const providers = result.searchProviders && result.searchProviders.length > 0
        ? result.searchProviders
        : (result.searchProvider ? [result.searchProvider] : ["unknown"]);
      const primaryProvider = providers[0];

      if (!groups[primaryProvider]) {
        groups[primaryProvider] = [];
      }

      groups[primaryProvider].push(result);
      return groups;
    }, {})
  );

  // Close export options when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (exportDropdownRef.current && !exportDropdownRef.current.contains(event.target as Node)) {
        setShowExportOptions(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Load history from localStorage
  useEffect(() => {
    const savedHistory = localStorage.getItem('webbook_history');
    if (savedHistory) {
      try {
        setHistory(JSON.parse(savedHistory));
      } catch (e) {
        console.error("Failed to parse history", e);
      }
    }
  }, []);

  useEffect(() => {
    const savedSourceConfig = localStorage.getItem(SOURCE_PORTAL_STORAGE_KEY);
    if (savedSourceConfig) {
      try {
        setSourceConfig(sanitizeSourceConfig(JSON.parse(savedSourceConfig)));
      } catch (e) {
        console.error("Failed to parse source config", e);
      }
    }
  }, []);

  // Save history to localStorage
  useEffect(() => {
    localStorage.setItem('webbook_history', JSON.stringify(history));
  }, [history]);

  useEffect(() => {
    localStorage.setItem(SOURCE_PORTAL_STORAGE_KEY, JSON.stringify(sourceConfig));
  }, [sourceConfig]);

  useEffect(() => {
    if (!artifactIsActive || !artifacts.startedAt) {
      return;
    }

    setArtifactClock(Date.now());
    const intervalId = window.setInterval(() => {
      setArtifactClock(Date.now());
    }, 1000);

    return () => window.clearInterval(intervalId);
  }, [artifactIsActive, artifacts.startedAt]);

  // Keep the query-preview trigger responsive to both width and height overflow.
  useLayoutEffect(() => {
    const updateOverflowState = () => {
      const el = textareaRef.current;
      if (!el || !query) {
        setIsOverflowing(false);
        return;
      }

      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d');
      const style = window.getComputedStyle(el);
      const paddingLeft = parseFloat(style.paddingLeft) || 0;
      const paddingRight = parseFloat(style.paddingRight) || 0;
      const availableWidth = el.clientWidth - paddingLeft - paddingRight;
      const lines = query.split('\n');

      if (context) {
        context.font = style.font;
      }

      const measuredLineWidths = context
        ? lines.map((line) => context.measureText(line || ' ').width)
        : [0];

      const widestLine = measuredLineWidths.length > 0 ? Math.max(...measuredLineWidths) : 0;
      const hasHorizontalOverflow = widestLine > availableWidth;
      const hasVerticalOverflow = el.scrollHeight > el.clientHeight + 1;

      setIsOverflowing(hasHorizontalOverflow || hasVerticalOverflow);
    };

    updateOverflowState();
    window.addEventListener('resize', updateOverflowState);

    const resizeObserver = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(updateOverflowState)
      : null;

    if (textareaRef.current) {
      resizeObserver?.observe(textareaRef.current);
    }

    return () => {
      window.removeEventListener('resize', updateOverflowState);
      resizeObserver?.disconnect();
    };
  }, [query]);

  useLayoutEffect(() => {
    if (!shouldShowQueryTooltip) {
      setQueryTooltipPosition(null);
      return;
    }

    let frameId = 0;

    const updateTooltipPosition = () => {
      const anchorEl = textareaRef.current;
      const tooltipEl = queryTooltipRef.current;

      if (!anchorEl || !tooltipEl) {
        return;
      }

      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const anchorRect = anchorEl.getBoundingClientRect();
      const availableViewportWidth = Math.max(1, viewportWidth - QUERY_TOOLTIP_VIEWPORT_MARGIN * 2);
      const width = Math.min(
        QUERY_TOOLTIP_MAX_WIDTH,
        Math.max(anchorRect.width, QUERY_TOOLTIP_MIN_WIDTH),
        availableViewportWidth,
      );
      const maxHeight = Math.min(
        QUERY_TOOLTIP_MAX_HEIGHT,
        Math.max(140, viewportHeight - QUERY_TOOLTIP_VIEWPORT_MARGIN * 2),
      );

      tooltipEl.style.width = `${width}px`;
      tooltipEl.style.maxHeight = `${maxHeight}px`;

      const tooltipRect = tooltipEl.getBoundingClientRect();
      const spaceAbove = anchorRect.top - QUERY_TOOLTIP_VIEWPORT_MARGIN;
      const spaceBelow = viewportHeight - anchorRect.bottom - QUERY_TOOLTIP_VIEWPORT_MARGIN;
      const placeBelow = spaceAbove < tooltipRect.height + QUERY_TOOLTIP_GAP && spaceBelow > spaceAbove;
      const left = clamp(
        anchorRect.left,
        QUERY_TOOLTIP_VIEWPORT_MARGIN,
        viewportWidth - width - QUERY_TOOLTIP_VIEWPORT_MARGIN,
      );
      const top = placeBelow
        ? clamp(
            anchorRect.bottom + QUERY_TOOLTIP_GAP,
            QUERY_TOOLTIP_VIEWPORT_MARGIN,
            viewportHeight - tooltipRect.height - QUERY_TOOLTIP_VIEWPORT_MARGIN,
          )
        : clamp(
            anchorRect.top - tooltipRect.height - QUERY_TOOLTIP_GAP,
            QUERY_TOOLTIP_VIEWPORT_MARGIN,
            viewportHeight - tooltipRect.height - QUERY_TOOLTIP_VIEWPORT_MARGIN,
          );
      const arrowAnchorX = clamp(anchorRect.left + 40, anchorRect.left + 18, anchorRect.right - 18);
      const arrowLeft = clamp(arrowAnchorX - left, 18, width - 18);

      setQueryTooltipPosition((current) => {
        if (
          current &&
          current.top === top &&
          current.left === left &&
          current.width === width &&
          current.maxHeight === maxHeight &&
          current.arrowLeft === arrowLeft &&
          current.placement === (placeBelow ? 'bottom' : 'top') &&
          current.ready
        ) {
          return current;
        }

        return {
          top,
          left,
          width,
          maxHeight,
          arrowLeft,
          placement: placeBelow ? 'bottom' : 'top',
          ready: true,
        };
      });
    };

    const scheduleTooltipUpdate = () => {
      window.cancelAnimationFrame(frameId);
      frameId = window.requestAnimationFrame(updateTooltipPosition);
    };

    scheduleTooltipUpdate();
    window.addEventListener('resize', scheduleTooltipUpdate);
    window.addEventListener('scroll', scheduleTooltipUpdate, true);

    const resizeObserver = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(scheduleTooltipUpdate)
      : null;

    if (textareaRef.current) {
      resizeObserver?.observe(textareaRef.current);
    }

    return () => {
      window.cancelAnimationFrame(frameId);
      window.removeEventListener('resize', scheduleTooltipUpdate);
      window.removeEventListener('scroll', scheduleTooltipUpdate, true);
      resizeObserver?.disconnect();
    };
  }, [query, shouldShowQueryTooltip]);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedQuery = query.trim();
    if (!trimmedQuery) return;
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
      const { searchAndExtract, evolve, assembleWebBook } = await import('./services/evolutionService');
      
      // 1. Targeted Crawling & Ingestion - Strictly using Evolutionary Backend
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
      
      // 2. Evolutionary Processing Engine
      setState(s => ({ ...s, status: 'evolving', population: initialPopulation }));
      const evolvedPopulation = await evolve(initialPopulation, trimmedQuery);
      setArtifacts((current) => ({
        ...current,
        status: 'assembling',
        searchResults: initialPopulation,
        evolvedPopulation,
        updatedAt: Date.now(),
      }));
      
      // 3. Web-Book Assembly
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

  const deleteHistoryItem = (id: string) => {
    setHistory(prev => prev.filter(item => item.id !== id));
  };

  const clearAllHistory = () => {
    if (window.confirm("Are you sure you want to delete all search history?")) {
      setHistory([]);
    }
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
    setArtifacts(EMPTY_ARTIFACTS);
    setState({
      generation: 0,
      population: [],
      bestFitness: 0,
      status: 'idle'
    });
    if (textareaRef.current) {
      textareaRef.current.focus();
    }
  };

  const getExportBaseName = () => {
    const raw = webBook?.topic?.trim() || 'webbook';
    const sanitized = raw
      .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '')
      .replace(/\s+/g, '_')
      .trim();
    return sanitized || 'webbook';
  };

  const escapeHtml = (value: string) => value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

  const applyResolvedStyles = (source: HTMLElement, target: HTMLElement) => {
    const computedStyle = window.getComputedStyle(source);

    for (let index = 0; index < computedStyle.length; index += 1) {
      const propertyName = computedStyle.item(index);
      target.style.setProperty(
        propertyName,
        computedStyle.getPropertyValue(propertyName),
        computedStyle.getPropertyPriority(propertyName),
      );
    }

    target.style.setProperty('animation', 'none');
    target.style.setProperty('transition', 'none');

    const sourceChildren = Array.from(source.children);
    const targetChildren = Array.from(target.children);

    sourceChildren.forEach((child, index) => {
      const targetChild = targetChildren[index];
      if (child instanceof HTMLElement && targetChild instanceof HTMLElement) {
        applyResolvedStyles(child, targetChild);
      }
    });
  };

  const createCleanExportClone = () => {
    const sourceElement = document.querySelector('.web-book-container');
    if (!(sourceElement instanceof HTMLElement)) {
      return null;
    }

    const clone = sourceElement.cloneNode(true) as HTMLElement;
    applyResolvedStyles(sourceElement, clone);
    
    // Sanitize oklab/oklch colors which html2canvas fails to parse
    const sanitizeColors = (el: HTMLElement) => {
      const style = window.getComputedStyle(el);
      const props = ['color', 'backgroundColor', 'borderColor', 'outlineColor'];
      props.forEach(prop => {
        const val = (el.style as any)[prop] || style.getPropertyValue(prop);
        if (val && (val.includes('oklab') || val.includes('oklch'))) {
          // Fallback to a safe color if oklab/oklch is detected
          // Since we can't easily convert oklab to hex in browser without a library,
          // we'll just use the computed rgb value if available, or a default.
          // Computed style usually returns rgb/rgba even if source is oklab.
          if (val.startsWith('rgb')) {
             el.style.setProperty(prop, val, 'important');
          } else {
             el.style.setProperty(prop, prop === 'color' ? '#141414' : '#ffffff', 'important');
          }
        }
      });
      Array.from(el.children).forEach(child => {
        if (child instanceof HTMLElement) sanitizeColors(child);
      });
    };
    sanitizeColors(clone);

    clone.querySelectorAll('button, .print\\:hidden, [data-html2canvas-ignore]').forEach((el) => el.remove());
    clone.querySelectorAll('a[href="#top"]').forEach((anchor) => anchor.removeAttribute('href'));
    clone.style.setProperty('box-shadow', 'none');
    clone.style.setProperty('transform', 'none');
    clone.style.setProperty('overflow', 'visible');

    return clone;
  };

  const inlinePdfImages = async (root: HTMLElement) => {
    const images = Array.from(root.querySelectorAll('img'));

    for (const img of images) {
      try {
        if (!img.src || img.src.startsWith('data:') || img.style.display === 'none') {
          continue;
        }

        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        const tempImg = new Image();
        tempImg.crossOrigin = 'anonymous';
        tempImg.referrerPolicy = 'no-referrer';

        await new Promise<void>((resolve, reject) => {
          const timeout = window.setTimeout(() => reject(new Error('Image load timeout')), 4000);
          tempImg.onload = () => {
            window.clearTimeout(timeout);
            resolve();
          };
          tempImg.onerror = () => {
            window.clearTimeout(timeout);
            reject(new Error('Image load error'));
          };
          tempImg.src = img.src;
        });

        let width = tempImg.width;
        let height = tempImg.height;

        if (width > PDF_IMAGE_MAX_DIMENSION || height > PDF_IMAGE_MAX_DIMENSION) {
          if (width >= height) {
            height = Math.round((height / width) * PDF_IMAGE_MAX_DIMENSION);
            width = PDF_IMAGE_MAX_DIMENSION;
          } else {
            width = Math.round((width / height) * PDF_IMAGE_MAX_DIMENSION);
            height = PDF_IMAGE_MAX_DIMENSION;
          }
        }

        canvas.width = width;
        canvas.height = height;
        context?.drawImage(tempImg, 0, 0, width, height);
        img.src = canvas.toDataURL('image/jpeg', 0.72);
      } catch (error) {
        console.warn('Skipping image in PDF export:', error);
        img.style.display = 'none';
      }

      img.style.filter = 'none';
      img.style.boxShadow = 'none';
      img.className = img.className.replace(/grayscale|hover:grayscale-0/g, '');
    }
  };

  const createHiddenPdfExportClone = () => {
    const clone = createCleanExportClone();
    if (!clone) {
      return null;
    }

    const wrapper = document.createElement('div');
    wrapper.setAttribute('aria-hidden', 'true');
    Object.assign(wrapper.style, {
      position: 'fixed',
      left: '-20000px',
      top: '0',
      width: `${PDF_EXPORT_PAGE_WIDTH}px`,
      zIndex: '-1',
      pointerEvents: 'none',
      background: 'white',
      overflow: 'hidden',
    });

    clone.style.width = `${PDF_EXPORT_PAGE_WIDTH}px`;
    clone.style.maxWidth = `${PDF_EXPORT_PAGE_WIDTH}px`;
    clone.style.margin = '0';
    clone.style.padding = '0';
    clone.style.background = 'transparent';
    clone.style.boxShadow = 'none';
    clone.style.border = 'none';
    clone.style.gap = '0';

    clone.querySelectorAll<HTMLElement>('[data-pdf-page-number]').forEach((page) => {
      page.style.width = `${PDF_EXPORT_PAGE_WIDTH}px`;
      page.style.minHeight = `${PDF_EXPORT_PAGE_HEIGHT}px`;
      page.style.margin = '0';
      page.style.borderRadius = '0';
      page.style.boxShadow = 'none';
      page.style.overflow = 'hidden';
      page.style.setProperty('break-inside', 'avoid');
      page.style.pageBreakAfter = 'always';
    });

    wrapper.appendChild(clone);
    document.body.appendChild(wrapper);

    return {
      clone,
      cleanup: () => wrapper.remove(),
    };
  };

  const collectPdfLinkAnnotations = (root: HTMLElement): PdfLinkAnnotation[] =>
    Array.from(root.querySelectorAll<HTMLElement>('[data-pdf-target-page]'))
      .map((element) => {
        const sourcePage = element.closest<HTMLElement>('[data-pdf-page-number]');
        const sourcePageNumber = Number(sourcePage?.dataset.pdfPageNumber);
        const targetPageNumber = Number(element.dataset.pdfTargetPage);

        if (!sourcePage || !Number.isFinite(sourcePageNumber) || !Number.isFinite(targetPageNumber)) {
          return null;
        }

        const sourceRect = sourcePage.getBoundingClientRect();
        const elementRect = element.getBoundingClientRect();
        if (!sourceRect.width || !sourceRect.height || !elementRect.width || !elementRect.height) {
          return null;
        }

        return {
          sourcePageNumber,
          targetPageNumber,
          xRatio: (elementRect.left - sourceRect.left) / sourceRect.width,
          yRatio: (elementRect.top - sourceRect.top) / sourceRect.height,
          widthRatio: elementRect.width / sourceRect.width,
          heightRatio: elementRect.height / sourceRect.height,
        };
      })
      .filter((annotation): annotation is PdfLinkAnnotation => Boolean(annotation));

  const getHeadMarkupForPrint = () => Array.from(
    document.head.querySelectorAll('style, link[rel="stylesheet"]')
  )
    .map((node) => node.outerHTML)
    .join('\n');

  const exportToTXT = () => {
    if (!webBook) return;
    setIsExporting(true);
    setShowExportOptions(false);
    
    setTimeout(() => {
      let text = `${webBook.topic.toUpperCase()}\n`;
      text += `Generated on: ${new Date(webBook.timestamp).toLocaleString()}\n\n`;
      
      chapterRenderPlan.forEach(({ chapter, renderableDefinitions, renderableSubTopics }, i) => {
        text += `CHAPTER ${i + 1}: ${chapter.title}\n`;
        text += `${"=".repeat(chapter.title.length + 11)}\n\n`;
        text += `${chapter.content}\n\n`;
        
        text += `VISUAL CONCEPT: ${chapter.visualSeed}\n\n`;
        
        text += `CORE CONCEPTS:\n`;
        renderableDefinitions.forEach(def => {
          text += `- ${def.term}: ${def.description}\n`;
        });
        text += `\n`;
        
        text += `SUB-TOPICS:\n`;
        renderableSubTopics.forEach(sub => {
          text += `- ${sub.title}: ${sub.summary}\n`;
        });
        text += `\nSOURCES:\n`;
        chapter.sourceUrls.forEach(source => {
          const normalizedSource = normalizeSourceReference(source);
          text += `- ${normalizedSource.title}: ${normalizedSource.url}\n`;
        });
        text += `\n\n`;
      });

      const blob = new Blob([text], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${getExportBaseName()}.txt`;
      a.click();
      URL.revokeObjectURL(url);
      setIsExporting(false);
    }, 800);
  };

  const exportToHTML = () => {
    if (!webBook) return;
    const htmlContent = document.querySelector('.web-book-container')?.innerHTML;
    if (!htmlContent) return;

    setIsExporting(true);
    setShowExportOptions(false);

    setTimeout(() => {
      const fullHtml = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <title>${webBook.topic}</title>
          <script src="https://cdn.tailwindcss.com"></script>
          <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;700&family=Playfair+Display:ital,wght@0,400;0,700;1,400;1,700&family=JetBrains+Mono:wght@400;700&display=swap" rel="stylesheet">
          <style>
            body { font-family: 'Inter', sans-serif; background: #E4E3E0; padding: 40px 0; }
            .font-serif { font-family: 'Playfair Display', serif; }
            .font-mono { font-family: 'JetBrains Mono', monospace; }
            * { word-break: break-word; overflow-wrap: break-word; }
          </style>
        </head>
        <body>
          <div id="top" class="max-w-[850px] mx-auto bg-white border border-black shadow-xl">
            ${htmlContent}
          </div>
        </body>
        </html>
      `;

      const blob = new Blob([fullHtml], { type: 'text/html' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${getExportBaseName()}.html`;
      a.click();
      URL.revokeObjectURL(url);
      setIsExporting(false);
    }, 800);
  };

  const exportToWord = async () => {
    if (!webBook) return;
    const element = document.querySelector('.web-book-container');
    if (!element) return;

    setIsExporting(true);
    setShowExportOptions(false);

    try {
      // Create a clone to modify for Word export
      const clone = element.cloneNode(true) as HTMLElement;
      
      // Remove elements that don't translate well
      clone.querySelectorAll('button, .print\\:hidden, [data-html2canvas-ignore]').forEach(el => el.remove());
      
      // Convert images to base64 to ensure they are embedded in Word
      const images = clone.querySelectorAll('img');
      for (const img of Array.from(images)) {
        try {
          const response = await fetch(img.src, { mode: 'cors' });
          if (response.ok) {
            const blob = await response.blob();
            const base64 = await new Promise<string>((resolve, reject) => {
              const reader = new FileReader();
              reader.onloadend = () => resolve(reader.result as string);
              reader.onerror = reject;
              reader.readAsDataURL(blob);
            });
            img.src = base64;
          }
        } catch (e) {
          console.error("Failed to convert image to base64 for Word export", e);
        }
        img.style.maxWidth = '100%';
        img.style.height = 'auto';
        img.style.display = 'block';
        img.style.margin = '20px auto';
      }

      const htmlContent = clone.innerHTML;
      const header = "<html xmlns:o='urn:schemas-microsoft-com:office:office' "+
              "xmlns:w='urn:schemas-microsoft-com:office:word' "+
              "xmlns='http://www.w3.org/TR/REC-html40'>"+
              "<head><meta charset='utf-8'><title>WebBook Export</title>"+
              "<style>body { font-family: 'Arial', sans-serif; } img { max-width: 100%; }</style></head><body>";
      const footer = "</body></html>";
      const sourceHTML = header + htmlContent + footer;
      
      const blob = new Blob(['\ufeff', sourceHTML], {
          type: 'application/msword'
      });
      
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${getExportBaseName()}.doc`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Word export failed:", err);
    } finally {
      setIsExporting(false);
    }
  };

  const exportToPDF = async () => {
    if (!webBook) return;

    setIsExporting(true);
    setShowExportOptions(false);

    let cleanup: (() => void) | null = null;

    try {
      const hiddenClone = createHiddenPdfExportClone();
      if (!hiddenClone) {
        throw new Error('Could not find the book container to export.');
      }

      cleanup = hiddenClone.cleanup;
      const { clone } = hiddenClone;

      const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
        import('html2canvas'),
        import('jspdf'),
      ]);

      await wait(80);
      await inlinePdfImages(clone);
      await wait(80);

      await document.fonts?.ready?.catch(() => undefined);

      const pages = Array.from(clone.querySelectorAll<HTMLElement>('[data-pdf-page-number]'));
      if (pages.length === 0) {
        throw new Error('No paged content found for PDF export.');
      }

      const linkAnnotations = collectPdfLinkAnnotations(clone);
      const pdf = new jsPDF({
        unit: 'mm',
        format: 'a4',
        orientation: 'portrait',
        compress: true,
        putOnlyUsedFonts: true,
      });
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = pdf.internal.pageSize.getHeight();
      const renderScale = getPdfRenderScale(pages.length);

      for (const [index, page] of pages.entries()) {
        if (index > 0) {
          pdf.addPage();
        }

        let canvas: HTMLCanvasElement;
        try {
          canvas = await html2canvas(page, {
            scale: renderScale,
            useCORS: true,
            logging: false,
            backgroundColor: '#ffffff',
            imageTimeout: 15000,
            removeContainer: true,
            foreignObjectRendering: false,
            windowWidth: PDF_EXPORT_PAGE_WIDTH,
            windowHeight: PDF_EXPORT_PAGE_HEIGHT,
            scrollX: 0,
            scrollY: 0,
          });
        } catch (pageError) {
          console.warn('Primary PDF page render failed, retrying without images:', pageError);
          page.querySelectorAll('img').forEach((img) => {
            if (img instanceof HTMLElement) {
              img.style.display = 'none';
            }
          });

          canvas = await html2canvas(page, {
            scale: Math.max(1, renderScale - 0.25),
            useCORS: true,
            logging: false,
            backgroundColor: '#ffffff',
            imageTimeout: 10000,
            removeContainer: true,
            foreignObjectRendering: false,
            windowWidth: PDF_EXPORT_PAGE_WIDTH,
            windowHeight: PDF_EXPORT_PAGE_HEIGHT,
            scrollX: 0,
            scrollY: 0,
          });
        }

        const imageData = canvas.toDataURL('image/jpeg', 0.9);
        pdf.addImage(imageData, 'JPEG', 0, 0, pdfWidth, pdfHeight, undefined, 'MEDIUM');

        const sourcePageNumber = Number(page.dataset.pdfPageNumber);
        if (Number.isFinite(sourcePageNumber)) {
          linkAnnotations
            .filter((annotation) => annotation.sourcePageNumber === sourcePageNumber)
            .forEach((annotation) => {
              pdf.link(
                annotation.xRatio * pdfWidth,
                annotation.yRatio * pdfHeight,
                annotation.widthRatio * pdfWidth,
                annotation.heightRatio * pdfHeight,
                { pageNumber: annotation.targetPageNumber }
              );
            });
        }

        canvas.width = 0;
        canvas.height = 0;
        await wait(0);
      }

      pdf.save(`${getExportBaseName()}.pdf`);
    } catch (err) {
      console.error("PDF Export failed:", err);
      alert("High-res PDF export still hit a browser or embedded-app limit before finishing. The exporter now runs locally without the CDN helper, but very large books or blocked remote images can still fail. Please use 'Print / Save as PDF (Lightweight)' if this environment blocks the final render.");
    } finally {
      cleanup?.();
      setIsExporting(false);
    }
  };

  const exportToPrint = () => {
    if (!webBook) return;
    const clone = createCleanExportClone();
    if (!clone) {
      alert("Could not find the book container to print.");
      return;
    }

    setIsExporting(true);
    setShowExportOptions(false);

    const printWindow = window.open('', '_blank', 'noopener,noreferrer');
    if (!printWindow) {
      setIsExporting(false);
      alert("Please allow popups to use the print feature.");
      return;
    }

    clone.style.position = 'relative';
    clone.style.left = '0';
    clone.style.top = '0';
    clone.style.margin = '0 auto';
    clone.style.width = '100%';
    clone.style.maxWidth = '850px';

    const title = escapeHtml(webBook.topic);
    const headMarkup = getHeadMarkupForPrint();

    printWindow.document.open();
    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8" />
          <title>${title}</title>
          ${headMarkup}
          <style>
            html, body { background: white !important; margin: 0; padding: 0; }
            body { padding: 24px 0; }
            .print\\:hidden, [data-html2canvas-ignore] { display: none !important; }
            .web-book-container { max-width: 850px !important; margin: 0 auto !important; box-shadow: none !important; }
            @page { margin: 1cm; }
          </style>
        </head>
        <body>
          ${clone.outerHTML}
          <script>
            window.onload = () => {
              setTimeout(() => {
                window.focus();
                window.print();
              }, 350);
            };
            window.onafterprint = () => {
              window.close();
            };
          </script>
        </body>
      </html>
    `);
    printWindow.document.close();

    window.setTimeout(() => setIsExporting(false), 500);
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
    setShowHistory(false);
  };

  return (
    <div className="min-h-screen bg-[#E4E3E0] text-[#141414] font-sans selection:bg-[#141414] selection:text-[#E4E3E0]">
      {/* Header */}
      <header 
        data-html2canvas-ignore="true"
        className="border-b border-[#141414] p-4 md:p-6 flex flex-col md:flex-row justify-between items-center gap-4 bg-[#E4E3E0] sticky top-0 z-50 print:hidden"
      >
        <div className="flex items-center gap-3 w-full md:w-auto">
          <div className="w-10 h-10 bg-[#141414] flex items-center justify-center rounded-sm shrink-0">
            <Dna className="text-[#E4E3E0] w-6 h-6" />
          </div>
          <div className="overflow-hidden">
            <h1 className="text-lg md:text-xl font-bold tracking-tighter uppercase italic font-serif truncate">Evolutionary Web-Book Engine</h1>
            <p className="text-[9px] md:text-[10px] uppercase tracking-widest opacity-60 truncate">Mitigating Search Redundancy via Evolutionary Computing</p>
          </div>
        </div>

        {/* Dynamic Navigation & Actions */}
        <div className="flex items-center gap-2 md:gap-6 w-full md:w-auto justify-between md:justify-end">
          {webBook && (
            <div className="hidden xl:flex items-center gap-3 border-x border-[#141414]/10 px-6 mx-2 h-10">
              <span className="text-[10px] font-bold uppercase tracking-widest opacity-40">Jump:</span>
              <div className="flex gap-1.5">
                {webBook.chapters.map((chapter, i) => (
                  <a 
                    key={chapter.id || i} 
                    href={`#chapter-${i}`}
                    className="w-7 h-7 flex items-center justify-center font-mono text-[10px] border border-[#141414]/10 hover:bg-[#141414] hover:text-white transition-all"
                    title={`Chapter ${i+1}`}
                  >
                    {i+1}
                  </a>
                ))}
              </div>
            </div>
          )}

          <div className="flex items-center flex-wrap justify-end gap-2 md:gap-4">
            {webBook && (
              <div className="flex items-center gap-2 md:gap-3 border-r border-[#141414]/10 pr-2 md:pr-4 mr-2 md:mr-4">
                <button 
                  id="new-search-btn-top"
                  onClick={startNewSearch}
                  className="px-3 md:px-4 py-2 border border-[#141414] text-[9px] md:text-[10px] uppercase font-bold tracking-widest hover:bg-[#141414] hover:text-white transition-all active:scale-95"
                  title="Start a fresh search and clear current results"
                >
                  New Search
                </button>
                
                <div className="relative" ref={exportDropdownRef}>
                  <button 
                    id="export-dropdown-btn"
                    onClick={() => setShowExportOptions(!showExportOptions)}
                    aria-expanded={showExportOptions}
                    aria-haspopup="true"
                    disabled={isExporting}
                    className="px-3 md:px-4 py-2 bg-[#141414] text-[#E4E3E0] text-[9px] md:text-[10px] uppercase font-bold tracking-widest hover:bg-opacity-90 transition-all flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                    title="Export the current Web-book to various formats"
                  >
                    {isExporting ? (
                      <Loader2 size={12} className="animate-spin" />
                    ) : (
                      <>
                        <Download size={12} /> <span className="hidden sm:inline">Export</span> <ChevronDown size={12} className={`transition-transform ${showExportOptions ? 'rotate-180' : ''}`} />
                      </>
                    )}
                  </button>

                  <AnimatePresence>
                    {showExportOptions && (
                      <motion.div 
                        id="export-options-menu"
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 10 }}
                        data-html2canvas-ignore
                        className="absolute top-full right-0 mt-2 w-48 bg-white border border-[#141414] shadow-2xl z-50 overflow-hidden print:hidden"
                      >
                        <button 
                          id="export-pdf-btn"
                          onClick={() => { exportToPDF(); setShowExportOptions(false); }}
                          className="w-full px-4 py-3 text-left text-[10px] uppercase font-bold hover:bg-[#F5F5F5] flex items-center gap-3 border-b border-[#141414]/10"
                          title="Generate a high-resolution PDF document (Best for printing)"
                        >
                          <FileText size={14} className="text-red-600" /> PDF Document (High Res)
                        </button>
                        <button 
                          id="export-print-btn"
                          onClick={() => { exportToPrint(); setShowExportOptions(false); }}
                          className="w-full px-4 py-3 text-left text-[10px] uppercase font-bold hover:bg-[#F5F5F5] flex items-center gap-3 border-b border-[#141414]/10"
                          title="Use browser print to save as PDF (Fast and lightweight)"
                        >
                          <Printer size={14} className="text-green-600" /> Print / Save as PDF (Lightweight)
                        </button>
                        <button 
                          id="export-word-btn"
                          onClick={() => { exportToWord(); setShowExportOptions(false); }}
                          className="w-full px-4 py-3 text-left text-[10px] uppercase font-bold hover:bg-[#F5F5F5] flex items-center gap-3 border-b border-[#141414]/10"
                          title="Export as a Microsoft Word document (.doc)"
                        >
                          <FileText size={14} className="text-blue-600" /> Word (.doc)
                        </button>
                        <button 
                          id="export-html-btn"
                          onClick={() => { exportToHTML(); setShowExportOptions(false); }}
                          className="w-full px-4 py-3 text-left text-[10px] uppercase font-bold hover:bg-[#F5F5F5] flex items-center gap-3 border-b border-[#141414]/10"
                          title="Export as a standalone HTML webpage"
                        >
                          <FileCode size={14} className="text-orange-600" /> HTML Webpage
                        </button>
                        <button 
                          id="export-txt-btn"
                          onClick={() => { exportToTXT(); setShowExportOptions(false); }}
                          className="w-full px-4 py-3 text-left text-[10px] uppercase font-bold hover:bg-[#F5F5F5] flex items-center gap-3"
                          title="Export as a plain text file"
                        >
                          <FileText size={14} className="text-gray-600" /> Plain Text
                        </button>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </div>
            )}

            <div className="relative flex items-center">
              {artifactIsActive && (
                <motion.span
                  role="status"
                  aria-live="polite"
                  initial={{ opacity: 0.18 }}
                  animate={{ opacity: [0.18, 0.95, 0.28, 0.95] }}
                  transition={{ duration: 1.1, repeat: Infinity, ease: 'easeInOut' }}
                  className="pointer-events-none absolute right-[calc(100%+0.45rem)] top-1/2 max-w-[7.5rem] -translate-y-1/2 text-right text-[9px] font-semibold uppercase tracking-[0.18em] text-sky-700 sm:max-w-[9.5rem] sm:text-[10px] md:max-w-none"
                  title="Open Artifacts to follow processing details."
                >
                  <span className="sm:hidden">View details</span>
                  <span className="hidden sm:inline">View processing details</span>
                </motion.span>
              )}

            <button
              id="view-artifacts-btn"
              onClick={() => {
                setShowArtifacts(true);
                setShowHistory(false);
              }}
              aria-expanded={showArtifacts}
              className={`relative flex items-center gap-2 rounded-md px-2 py-1 text-[10px] font-bold uppercase tracking-wider transition-all duration-300 hover:opacity-70 md:text-[11px] ${
                artifactIsActive ? "bg-red-50/50 shadow-[0_0_15px_rgba(220,38,38,0.15)] ring-1 ring-red-200/50" : ""
              }`}
              title={artifactIsActive 
                ? "Monitor real-time Web-book generation: Search, Evolution, and Assembly in progress..." 
                : "View the underlying search and processing artifacts"}
            >
              <div className="relative">
                <Cpu size={14} className={artifactIsActive ? "text-red-600" : ""} />
                {artifactIsActive && (
                  <motion.span 
                    animate={{ 
                      opacity: [1, 0.4, 1, 0.8, 1],
                      scale: [1, 1.2, 1, 1.1, 1]
                    }}
                    transition={{ 
                      duration: 0.4, 
                      repeat: Infinity, 
                      times: [0, 0.2, 0.4, 0.6, 1],
                      ease: "easeInOut" 
                    }}
                    className="absolute -top-1 -right-1 h-2.5 w-2.5 rounded-full border border-white bg-red-600 shadow-[0_0_8px_rgba(220,38,38,0.8)]" 
                  />
                )}
              </div>
              <span className={`hidden sm:inline ${artifactIsActive ? "text-red-700" : ""}`}>Artifacts</span>
              {artifactIsActive && (
                <motion.span 
                  initial={{ opacity: 0 }}
                  animate={{ opacity: [0.15, 1, 0.3, 1] }}
                  transition={{ duration: 0.8, repeat: Infinity, ease: "linear" }}
                  className="ml-1 hidden lg:inline text-[9px] font-black tracking-[0.18em] text-red-600"
                >
                  ● LIVE
                </motion.span>
              )}
            </button>
            </div>

            <button 
              id="view-history-btn"
              onClick={() => {
                setShowHistory(true);
                setShowArtifacts(false);
              }}
              className="flex items-center gap-2 text-[10px] md:text-[11px] uppercase tracking-wider font-bold hover:opacity-70 transition-opacity"
              title="View previously generated Web-books"
            >
              <History size={14} /> <span className="hidden sm:inline">History</span>
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto p-6 grid grid-cols-1 lg:grid-cols-12 gap-8 print:block print:p-0">
        {/* Left Column: Search & Status */}
        <div 
          data-html2canvas-ignore="true"
          className="lg:col-span-4 space-y-8 print:hidden"
        >
          <section className="bg-white border border-[#141414] p-6 shadow-[4px_4px_0px_0px_rgba(20,20,20,1)]">
            <div className="flex justify-between items-center mb-4">
              <h2 className="font-serif italic text-sm uppercase opacity-50">Targeted Ingestion</h2>
              <button 
                id="new-search-btn-sidebar"
                onClick={startNewSearch}
                className="text-[10px] uppercase font-bold flex items-center gap-1 hover:underline"
                title="Start a new search"
              >
                <Plus size={12}/> New Search
              </button>
            </div>
            <form 
              id="search-form"
              onSubmit={handleSearch} 
              className="relative"
              onMouseEnter={() => setIsHoveringInput(true)}
              onMouseLeave={() => setIsHoveringInput(false)}
              onFocus={() => setIsHoveringInput(true)}
              onBlur={() => setIsHoveringInput(false)}
              onClick={() => setIsHoveringInput(true)}
            >
              <AnimatePresence>
                {shouldShowQueryTooltip && (
                  <motion.div
                    id="query-preview-tooltip"
                    ref={queryTooltipRef}
                    initial={{ opacity: 0, y: 10, scale: 0.95 }}
                    animate={{
                      opacity: queryTooltipPosition?.ready ? 1 : 0,
                      y: 0,
                      scale: queryTooltipPosition?.ready ? 1 : 0.98,
                    }}
                    exit={{ opacity: 0, y: 10, scale: 0.95 }}
                    className="fixed z-[80] pointer-events-none"
                    style={{
                      top: queryTooltipPosition?.top ?? QUERY_TOOLTIP_VIEWPORT_MARGIN,
                      left: queryTooltipPosition?.left ?? QUERY_TOOLTIP_VIEWPORT_MARGIN,
                      width: queryTooltipPosition?.width
                        ? `${queryTooltipPosition.width}px`
                        : `min(${QUERY_TOOLTIP_MAX_WIDTH}px, calc(100vw - ${QUERY_TOOLTIP_VIEWPORT_MARGIN * 2}px))`,
                      maxHeight: queryTooltipPosition?.maxHeight
                        ? `${queryTooltipPosition.maxHeight}px`
                        : `calc(100vh - ${QUERY_TOOLTIP_VIEWPORT_MARGIN * 2}px)`,
                      transformOrigin: queryTooltipPosition?.placement === 'bottom' ? 'left top' : 'left bottom',
                    }}
                    aria-hidden="true"
                  >
                    <div className="flex max-h-full flex-col overflow-hidden bg-yellow-300 text-[#141414] p-4 border-2 border-[#141414] shadow-[6px_6px_0px_0px_rgba(20,20,20,1)] text-sm font-mono">
                      <div className="flex items-center gap-2 mb-2 opacity-70 text-[10px] uppercase font-bold tracking-widest">
                        <Info size={12} className="text-[#141414]" /> Full Search Query Preview
                      </div>
                      <div className="min-h-0 overflow-y-auto pr-1 leading-relaxed whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
                        {query}
                      </div>
                      <div className="mt-2 text-[9px] opacity-40 italic">
                        Text exceeds box width. Showing full query for accessibility.
                      </div>
                    </div>
                    <div
                      className={`absolute w-4 h-4 bg-yellow-300 border-[#141414] rotate-45 ${
                        queryTooltipPosition?.placement === 'bottom'
                          ? '-top-2 border-l-2 border-t-2'
                          : '-bottom-2 border-r-2 border-b-2'
                      }`}
                      style={{ left: `${(queryTooltipPosition?.arrowLeft ?? 24) - 8}px` }}
                    />
                  </motion.div>
                )}
              </AnimatePresence>

              <textarea 
                id="search-query-input"
                ref={textareaRef}
                rows={1}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Enter search topic..."
                className="w-full bg-[#F5F5F5] border border-[#141414] p-4 pr-14 focus:outline-none focus:ring-0 text-base sm:text-lg font-mono resize-none overflow-y-auto max-h-32"
                style={{ height: 'auto', minHeight: '72px' }}
                disabled={isBusy}
                title="Enter your search topic here. Use Shift+Enter for new lines."
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSearch(e);
                  }
                }}
              />
              <button 
                id="search-submit-btn"
                type="submit"
                className="absolute right-4 top-1/2 -translate-y-1/2 w-8 h-8 bg-[#141414] text-[#E4E3E0] flex items-center justify-center hover:bg-opacity-90 transition-colors disabled:opacity-50 shadow-[2px_2px_0px_0px_rgba(0,0,0,0.2)]"
                disabled={isBusy}
                title="Run the evolutionary search engine"
              >
                {state.status === 'idle' || state.status === 'complete' ? <Search size={16} /> : <Loader2 size={16} className="animate-spin" />}
              </button>
            </form>
            <p className="mt-3 text-[10px] opacity-60 leading-relaxed">
              Initiates a multi-tiered pipeline: Targeted Crawling → NLP Extraction → Evolutionary Processing → Assembly.
            </p>

          </section>

          <section className="bg-white border border-[#141414] p-6 shadow-[4px_4px_0px_0px_rgba(20,20,20,1)]">
            <div className="flex justify-between items-center mb-4 gap-4">
              <div>
                <h2 className="font-serif italic text-sm uppercase opacity-50">Source Portal</h2>
                <p className="mt-1 text-[10px] opacity-60 leading-relaxed">
                  Blend multiple public sources by default, opt any source in or out, and add direct URLs when you want tighter control.
                </p>
              </div>
              <span className="shrink-0 text-[10px] uppercase font-bold tracking-widest px-2 py-1 border border-[#141414] bg-[#F5F5F5]">
                {totalEnabledSourceCount} active
              </span>
            </div>

            <div className="grid grid-cols-[repeat(auto-fit,minmax(14rem,1fr))] gap-3">
              {SOURCE_PORTAL_CARDS.map((source) => {
                const checked = sourceConfig.sources[source.key];
                const sourceToggleTitle = getSourceToggleTitle(source, checked);

                return (
                  <article
                    key={source.key}
                    id={`source-label-${source.key}`}
                    className={`border p-3 transition-all ${checked ? 'bg-[#141414] text-[#E4E3E0]' : 'bg-[#F8F8F8] text-[#141414]'} ${isBusy ? 'opacity-70' : 'hover:translate-x-[2px] hover:translate-y-[2px]'}`}
                    title={sourceToggleTitle}
                  >
                    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
                      <div className="min-w-0">
                        <span className="block text-[11px] uppercase font-bold tracking-[0.24em]">{source.label}</span>
                        <p className={`mt-2 text-[10px] leading-relaxed ${checked ? 'opacity-80' : 'opacity-60'}`}>
                          {source.description}
                        </p>
                      </div>
                      <button
                        id={`source-checkbox-${source.key}`}
                        type="button"
                        role="switch"
                        aria-checked={checked}
                        disabled={isBusy}
                        onClick={() => toggleBuiltInSource(source.key)}
                        className={`relative mt-0.5 h-6 w-11 shrink-0 rounded-full border transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-[#141414] focus-visible:ring-offset-2 ${
                          checked
                            ? 'border-white/30 bg-white/10'
                            : 'border-[#141414]/20 bg-white'
                        } ${isBusy ? 'cursor-not-allowed opacity-60' : 'cursor-pointer hover:scale-[1.03]'}`}
                        title={sourceToggleTitle}
                        aria-label={`${checked ? 'Turn off' : 'Turn on'} ${source.label}. ${source.usage}`}
                      >
                        <span
                          className={`absolute top-1/2 left-0 h-4 w-4 -translate-y-1/2 rounded-full transition-transform ${
                            checked
                              ? 'translate-x-[1.3rem] bg-[#E4E3E0]'
                              : 'translate-x-1 bg-[#141414]'
                          }`}
                        />
                        <span className="sr-only">{checked ? `Disable ${source.label}` : `Enable ${source.label}`}</span>
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <button
                id="all-sources-on-btn"
                type="button"
                onClick={() => setAllBuiltInSources(true)}
                disabled={isBusy}
                className="px-3 py-2 border border-[#141414] text-[10px] uppercase font-bold tracking-widest hover:bg-[#141414] hover:text-white transition-all disabled:opacity-50"
                title="Enable all built-in search sources"
              >
                All On
              </button>
              <button
                id="all-sources-off-btn"
                type="button"
                onClick={() => setAllBuiltInSources(false)}
                disabled={isBusy}
                className="px-3 py-2 border border-[#141414] text-[10px] uppercase font-bold tracking-widest hover:bg-[#141414] hover:text-white transition-all disabled:opacity-50"
                title="Disable all built-in search sources"
              >
                All Off
              </button>
            </div>

            <div className="mt-5 pt-5 border-t border-[#141414]/10">
              <div className="flex items-start justify-between gap-4 mb-3">
                <div>
                  <h3 className="text-[10px] uppercase font-bold tracking-widest">Execution Mode</h3>
                  <p className="mt-1 text-[10px] opacity-60 leading-relaxed">
                    Choose how the engine schedules source intake based on your machine and network stability.
                  </p>
                </div>
                <span className="shrink-0 text-[9px] uppercase font-bold tracking-widest px-2 py-1 border border-[#141414]/10 bg-[#F5F5F5]">
                  {sourceConfig.executionMode === 'parallel' ? 'High Throughput' : 'Recommended'}
                </span>
              </div>

              <div className="grid grid-cols-[repeat(auto-fit,minmax(15rem,1fr))] gap-3">
                {EXECUTION_MODE_CARDS.map((mode) => {
                  const selected = sourceConfig.executionMode === mode.key;

                  return (
                    <button
                      id={`execution-mode-${mode.key}`}
                      key={mode.key}
                      type="button"
                      onClick={() => setExecutionMode(mode.key)}
                      disabled={isBusy}
                      className={`min-w-0 text-left border p-4 transition-all ${
                        selected ? 'bg-[#141414] text-[#E4E3E0]' : 'bg-[#F8F8F8] text-[#141414]'
                      } ${isBusy ? 'opacity-70 cursor-not-allowed' : 'hover:translate-x-[2px] hover:translate-y-[2px]'}`}
                      aria-pressed={selected}
                      title={mode.description}
                    >
                      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-start gap-2">
                        <div className="min-w-0">
                          <span className="block text-[11px] uppercase font-bold tracking-widest">{mode.label}</span>
                          <p className={`mt-2 text-[10px] leading-relaxed ${selected ? 'opacity-80' : 'opacity-60'}`}>
                            {mode.description}
                          </p>
                        </div>
                        <span className={`mt-0.5 shrink-0 whitespace-nowrap text-[8px] uppercase font-bold tracking-[0.24em] border px-2 py-1 ${
                          selected ? 'border-white/30 bg-white/10' : 'border-[#141414]/20 bg-white'
                        }`}>
                          {selected ? 'Active' : 'Select'}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="mt-5 pt-5 border-t border-[#141414]/10">
              <label htmlFor="manual-source-input" className="block text-[10px] uppercase font-bold tracking-widest mb-2">
                Manual Sources
              </label>
              <div className="flex flex-col sm:flex-row gap-2">
                <textarea
                  id="manual-source-input"
                  rows={3}
                  value={manualSourceInput}
                  onChange={(e) => setManualSourceInput(e.target.value)}
                  placeholder="Paste URLs separated by spaces, commas, or new lines"
                  disabled={isBusy}
                  className="flex-1 bg-[#F5F5F5] border border-[#141414] p-3 focus:outline-none focus:ring-0 text-sm font-mono resize-y min-h-[88px] disabled:opacity-60"
                  title="Paste direct URLs here to include them in the analysis"
                />
                <button
                  id="add-manual-source-btn"
                  type="button"
                  onClick={addManualSources}
                  disabled={isBusy}
                  className="px-4 py-3 bg-[#141414] text-[#E4E3E0] text-[10px] uppercase font-bold tracking-widest hover:bg-opacity-90 transition-all disabled:opacity-50"
                  title="Add the provided URLs to the source list"
                >
                  Add Source
                </button>
              </div>
              <p className="mt-2 text-[10px] opacity-60 leading-relaxed">
                Manual URLs are fetched directly and merged with search-engine results. Up to 8 manual URLs are stored.
              </p>

              {sourceConfig.manualUrls.length > 0 && (
                <div className="mt-4 space-y-2">
                  {sourceConfig.manualUrls.map((url) => (
                    <div key={url} className="flex items-center justify-between gap-3 border border-[#141414]/10 bg-[#F8F8F8] px-3 py-2">
                      <a
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[11px] font-mono break-all hover:underline flex items-center gap-2"
                        title={`Visit ${url}`}
                      >
                        <ExternalLink size={12} className="shrink-0" />
                        {url}
                      </a>
                      <button
                        id={`remove-manual-source-${url}`}
                        type="button"
                        onClick={() => removeManualSource(url)}
                        disabled={isBusy}
                        className="shrink-0 p-2 text-red-600 hover:bg-red-50 rounded transition-colors disabled:opacity-50"
                        aria-label={`Remove manual source ${url}`}
                        title="Remove this manual source"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>

          {/* Engine Status */}
          <section className="bg-white border border-[#141414] p-6 shadow-[4px_4px_0px_0px_rgba(20,20,20,1)]">
            <h2 className="font-serif italic text-sm uppercase mb-6 opacity-50">Evolutionary Metrics</h2>
            
            <div className="space-y-6">
              <div className="flex justify-between items-end border-b border-[#141414] pb-2">
                <span className="text-[11px] uppercase font-bold">Status</span>
                <span className={`text-[11px] uppercase font-mono px-2 py-0.5 rounded-full ${state.status === 'complete' ? 'bg-green-100 text-green-800' : 'bg-blue-100 text-blue-800'}`}>
                  {state.status}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="border border-[#141414] p-3 bg-[#F5F5F5]">
                  <span className="block text-[9px] uppercase opacity-50 mb-1">Generation</span>
                  <span className="text-2xl font-mono font-bold">{state.generation}</span>
                </div>
                <div className="border border-[#141414] p-3 bg-[#F5F5F5]">
                  <span className="block text-[9px] uppercase opacity-50 mb-1">Pop. Size</span>
                  <span className="text-2xl font-mono font-bold">{state.population.length}</span>
                </div>
              </div>

              <div className="border border-[#141414] p-3 bg-[#F5F5F5]">
                <span className="block text-[9px] uppercase opacity-50 mb-1">Active Sources</span>
                <span className="text-[11px] font-mono leading-relaxed break-words">
                  {sourceSummary || 'None selected'}
                </span>
              </div>

              {state.status !== 'idle' && (
                <div className="space-y-2">
                  <div className="flex justify-between text-[10px] uppercase font-bold">
                    <span>Processing Pipeline</span>
                    <span>{state.status === 'complete' ? '100%' : 'In Progress'}</span>
                  </div>
                  <div className="h-2 bg-[#F5F5F5] border border-[#141414] overflow-hidden">
                    <motion.div 
                      className="h-full bg-[#141414]"
                      initial={{ width: 0 }}
                      animate={{ width: state.status === 'complete' ? '100%' : '60%' }}
                      transition={{ duration: 2, ease: "easeInOut" }}
                    />
                  </div>
                </div>
              )}

              {error && (
                <div className="bg-red-50 border border-red-200 p-3 text-red-800 text-xs flex gap-2 items-start">
                  <AlertCircle size={14} className="shrink-0 mt-0.5" />
                  <span>{error}</span>
                </div>
              )}
            </div>
          </section>

          {/* Legend */}
          <section className="p-4 border border-[#141414] border-dashed opacity-60">
            <h3 className="text-[10px] uppercase font-bold mb-3 flex items-center gap-2"><Info size={12}/> Fitness Function F(w)</h3>
            <p className="text-[10px] font-mono leading-relaxed">
              F(w) = αI(w) + βA(w) − γR(w,S)<br/>
              α: Informative Score (NLP)<br/>
              β: Authority Score (Topology)<br/>
              γ: Redundancy Penalty (Overlap)
            </p>
          </section>
        </div>

        {/* Right Column: Results */}
        <div className="lg:col-span-8 print:w-full">
          <div
            data-html2canvas-ignore="true"
            className="mb-4 border border-[#141414]/10 bg-white/75 p-3 shadow-[3px_3px_0px_0px_rgba(20,20,20,0.12)] print:hidden"
          >
            <div className="flex gap-3 items-start">
              <Info size={14} className="mt-0.5 shrink-0 opacity-50" />
              <p className="text-[10px] leading-relaxed opacity-70 italic sm:text-[11px]">
                As an Evolutionary Computing engine, this system performs real-time crawling, analysis, and
                information consolidation. Complex queries may take up to 5 minutes to complete.
              </p>
            </div>
          </div>
          <AnimatePresence mode="wait">
            {!webBook && state.status === 'idle' && (
              <motion.div 
                key="empty"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="h-full flex flex-col items-center justify-center border-2 border-dashed border-[#141414] opacity-20 p-20 text-center"
              >
                <BookOpen size={80} strokeWidth={1} />
                <p className="mt-6 font-serif italic text-xl">Enter a topic to generate a structured Web-book</p>
              </motion.div>
            )}

            {state.status === 'searching' || state.status === 'evolving' || state.status === 'assembling' ? (
              <motion.div 
                key="loading"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="flex h-full flex-col items-center justify-start border border-[#141414] bg-white px-8 pb-16 pt-16 text-center shadow-[8px_8px_0px_0px_rgba(20,20,20,1)] sm:px-12 sm:pt-20 lg:px-16 lg:pt-24"
              >
                <div className="relative">
                  <Loader2 size={60} className="animate-spin text-[#141414]" />
                  <Dna size={30} className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" />
                </div>
                <h3 className="mt-6 font-serif italic text-2xl uppercase tracking-tight">Evolving Knowledge Structure</h3>
                <p className="mx-auto mt-4 max-w-md text-sm opacity-60">
                  The engine is currently mining concepts, evaluating informative value, and pruning redundant data structures...
                </p>
                <div className="mt-8 grid w-full max-w-lg grid-cols-3 gap-6 sm:mt-10 sm:gap-8">
                   {['Crawling', 'Evolving', 'Assembling'].map((step, i) => (
                     <div key={step} className="flex flex-col items-center gap-2">
                        <div className={`w-3 h-3 rounded-full border border-[#141414] ${state.status === step.toLowerCase() || (state.status === 'searching' && i === 0) || (state.status === 'evolving' && i === 1) || (state.status === 'assembling' && i === 2) ? 'bg-[#141414]' : 'bg-transparent'}`} />
                        <span className="text-[9px] uppercase font-bold tracking-widest">{step}</span>
                     </div>
                   ))}
                </div>
              </motion.div>
            ) : webBook && (
              <motion.div 
                key="content"
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                className="flex flex-col items-center gap-8 pb-20 print:block print:p-0"
              >
                {/* Document Container - Mimics A4/PDF */}
                <div id="top" className="web-book-container w-full max-w-[850px] bg-white border border-[#141414] shadow-[12px_12px_0px_0px_rgba(20,20,20,1)] overflow-hidden print:shadow-none print:border-none print:max-w-none">
                  {/* PDF Style Header / Cover */}
                  <div
                    data-pdf-page-number="1"
                    data-pdf-page-kind="cover"
                    className="bg-[#141414] text-[#E4E3E0] p-16 relative overflow-hidden text-center min-h-[1000px] flex flex-col justify-center print:break-inside-avoid print:page-break-after-always"
                  >
                    <div className="relative z-10">
                      <div className="flex flex-col items-center gap-4 mb-8">
                        <div className="w-12 h-12 border-2 border-[#E4E3E0] flex items-center justify-center rotate-45">
                          <Layers size={24} className="-rotate-45" />
                        </div>
                        <span className="text-[10px] uppercase tracking-[0.5em] opacity-60">Evolutionary Web-Book Engine</span>
                      </div>
                      <h2 className="text-7xl font-serif italic font-bold tracking-tighter leading-tight mb-8">{webBook.topic}</h2>
                      <div className="w-24 h-1 bg-[#E4E3E0] mx-auto mb-12 opacity-30" />
                      <div className="flex justify-center gap-16">
                        <div className="flex flex-col">
                          <span className="text-[9px] uppercase opacity-50 mb-2 tracking-widest">Chapters</span>
                          <span className="text-3xl font-mono">{webBook.chapters.length}</span>
                        </div>
                        <div className="flex flex-col">
                          <span className="text-[9px] uppercase opacity-50 mb-2 tracking-widest">Concepts</span>
                          <span className="text-3xl font-mono">{renderableConceptCount}</span>
                        </div>
                        <div className="flex flex-col">
                          <span className="text-[9px] uppercase opacity-50 mb-2 tracking-widest">Date</span>
                          <span className="text-3xl font-mono">{new Date(webBook.timestamp).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })}</span>
                        </div>
                      </div>
                    </div>
                    {/* Decorative background elements */}
                    <div className="absolute top-0 left-0 w-full h-full opacity-10 pointer-events-none">
                      <div className="absolute top-10 left-10 w-80 h-80 border border-white rounded-full" />
                      <div className="absolute bottom-10 right-10 w-96 h-96 border border-white rounded-full" />
                    </div>
                    <div className="absolute bottom-12 left-1/2 -translate-x-1/2 text-[10px] font-mono opacity-40">
                      PAGE 1
                    </div>
                  </div>

                  {/* Table of Contents - Page 2 Style */}
                  <div
                    data-pdf-page-number="2"
                    data-pdf-page-kind="toc"
                    className="p-20 border-b border-[#141414] bg-[#FAFAFA] min-h-[1000px] flex flex-col print:break-inside-avoid print:page-break-after-always relative"
                  >
                    <h3 className="text-[14px] uppercase font-bold mb-16 tracking-[0.3em] border-b-2 border-[#141414] pb-6 inline-block self-start">Table of Contents</h3>
                    <div className="space-y-8 flex-1">
                      {chapterRenderPlan.map(({ chapter, titlePageNumber }, i) => (
                        <a 
                          id={`toc-link-${i}`}
                          key={chapter.id || i} 
                          href={`#chapter-${i}`} 
                          data-pdf-target-page={titlePageNumber}
                          className="flex items-end gap-6 group"
                          title={`Jump to Chapter ${i+1}: ${chapter.title}`}
                        >
                          <span className="font-mono text-base opacity-40">0{i+1}</span>
                          <span className="text-xl font-medium group-hover:underline underline-offset-8 decoration-1">{chapter.title}</span>
                          <div className="flex-1 border-b border-dotted border-[#141414] opacity-20 mb-2" />
                          <span className="font-mono text-base opacity-40">P.{titlePageNumber}</span>
                        </a>
                      ))}
                    </div>
                    <div className="mt-auto pt-12 flex justify-center text-[10px] font-mono opacity-40">
                      PAGE 2
                    </div>
                  </div>

                  {/* Chapters - Paginated Experience */}
                  <div className="bg-[#F0F0F0] p-8 space-y-12">
                    {chapterRenderPlan.map(({ chapter, titlePageNumber, analysisPageNumber, renderableDefinitions, renderableSubTopics }, i) => {
                      const { lead, remainder } = splitChapterContent(chapter.content);
                      const primarySource = chapter.sourceUrls[0]
                        ? normalizeSourceReference(chapter.sourceUrls[0])
                        : null;

                      return (
                      <div key={chapter.id || i} className="space-y-12">
                        {/* Chapter Page 1: Title & Image */}
                        <section
                          id={`chapter-${i}`}
                          data-pdf-page-number={String(titlePageNumber)}
                          data-pdf-page-kind="chapter"
                          className="p-16 bg-white border border-[#141414] shadow-sm min-h-[1000px] flex flex-col print:break-inside-avoid print:page-break-after-always"
                        >
                          <div className="flex items-center justify-between mb-12 border-b border-[#141414]/10 pb-6">
                            <div className="flex items-center gap-4">
                              <span className="w-10 h-10 bg-[#141414] text-white flex items-center justify-center font-mono text-sm">0{i+1}</span>
                              <h3 className="text-4xl font-serif italic font-bold tracking-tight">{chapter.title}</h3>
                            </div>
                            <div className="text-[10px] uppercase font-bold opacity-30 tracking-widest">Chapter {i+1} / {chapterRenderPlan.length}</div>
                          </div>

                          <div className="mb-12 relative group">
                            <div className="aspect-[16/9] w-full overflow-hidden border border-[#141414] bg-[#F5F5F5] shadow-inner">
                              <img 
                                src={`https://picsum.photos/seed/${chapter.visualSeed || chapter.title}/1200/800`}
                                alt={chapter.title}
                                referrerPolicy="no-referrer"
                                crossOrigin="anonymous"
                                className="w-full h-full object-cover grayscale hover:grayscale-0 transition-all duration-1000 scale-105 group-hover:scale-100"
                              />
                            </div>
                            <div className="absolute -bottom-4 right-8 bg-white border border-[#141414] px-4 py-2 text-[10px] uppercase font-bold tracking-widest flex items-center gap-3 shadow-md">
                              <ImageIcon size={12} /> {chapter.visualSeed}
                            </div>
                          </div>

                          <div className="flex-1">
                            <p className="text-xl leading-relaxed text-gray-800 mb-12 font-light first-letter:text-6xl first-letter:font-serif first-letter:mr-3 first-letter:float-left first-letter:leading-none">
                              {lead}
                            </p>
                            {remainder && (
                              <p className="text-lg leading-relaxed text-gray-700 font-light">
                                {remainder}
                              </p>
                            )}
                          </div>

                          <div className="mt-auto pt-12 flex justify-between items-center border-t border-[#141414]/5 text-[10px] font-mono opacity-40">
                            <span>{webBook.topic}</span>
                            <span>PAGE {titlePageNumber}</span>
                          </div>
                        </section>

                        {/* Chapter Page 2: Analysis & Glossary */}
                        {analysisPageNumber !== null && (
                          <section
                            data-pdf-page-number={String(analysisPageNumber)}
                            data-pdf-page-kind="analysis"
                            className="p-16 bg-white border border-[#141414] shadow-sm min-h-[1000px] flex flex-col print:break-inside-avoid print:page-break-after-always"
                          >
                            <div className="flex-1 space-y-12">
                              {renderableSubTopics.length > 0 && (
                                <div className="space-y-8">
                                  <h4 className="text-[12px] uppercase font-bold tracking-[0.2em] flex items-center gap-3 text-[#141414]/60 border-b border-[#141414]/10 pb-4">
                                    <Layers size={16} /> Deep Analysis & Sub-Topics
                                  </h4>
                                  <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
                                    {renderableSubTopics.map((sub, j) => (
                                      <div key={`${chapter.id}-sub-${j}`} className="relative pl-8 group">
                                        <div className="absolute left-0 top-0 bottom-0 w-[2px] bg-[#141414]/10 group-hover:bg-[#141414] transition-colors" />
                                        <h5 className="font-bold text-xl mb-3">{sub.title}</h5>
                                        <p className="text-base text-gray-600 leading-relaxed font-light">{sub.summary}</p>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}

                              {renderableDefinitions.length > 0 && (
                                <div className="bg-[#141414] text-white p-10 shadow-xl">
                                  <h4 className="text-[10px] uppercase font-bold tracking-[0.3em] mb-10 flex items-center gap-3 opacity-70 border-b border-white/10 pb-6">
                                    <BookOpen size={16} /> Technical Glossary
                                  </h4>
                                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-x-12 gap-y-10">
                                    {renderableDefinitions.map((def, j) => {
                                      const words = (def.description || "").split(/\s+/);
                                      const isLong = words.length > 100;
                                      const displayDescription =
                                        isLong ? words.slice(0, 100).join(" ") : def.description;

                                      return (
                                        <div key={`${chapter.id}-def-${j}`} className="group">
                                          <span className="font-mono text-[12px] font-bold block mb-3 uppercase text-blue-400 tracking-wider break-words">
                                            {def.term}
                                          </span>
                                          <p className="text-sm leading-relaxed opacity-80 font-light italic border-l border-white/10 pl-4 break-words">
                                            {displayDescription}
                                            {isLong && (
                                              <>
                                                ...{" "}
                                                <a 
                                                  href={def.sourceUrl} 
                                                  target="_blank" 
                                                  rel="noopener noreferrer"
                                                  className="text-blue-400 hover:underline font-bold not-italic"
                                                  title="Read the full definition on the source website"
                                                >
                                                  [Full Definition]
                                                </a>
                                              </>
                                            )}
                                          </p>
                                        </div>
                                      );
                                    })}
                                  </div>
                                  
                                  {primarySource && (
                                    <div className="mt-10 pt-6 border-t border-white/10">
                                      <div className="flex items-center gap-3 text-[9px] font-bold uppercase opacity-40 break-all">
                                        <div className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-pulse shrink-0" />
                                        Source Verification:{" "}
                                        <a 
                                          href={primarySource.url} 
                                          target="_blank" 
                                          rel="noopener noreferrer"
                                          className="hover:underline"
                                          title="Verify the information at the original source"
                                        >
                                          {primarySource.title}
                                        </a>
                                      </div>
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>

                            <div className="mt-auto pt-12 flex justify-between items-center border-t border-[#141414]/5 text-[10px] font-mono opacity-40">
                              <span>Evolutionary Node {i+1}.{chapter.visualSeed?.length || 0}</span>
                              <span>PAGE {analysisPageNumber}</span>
                            </div>
                          </section>
                        )}
                      </div>
                    )})}
                  </div>

                  {/* Document Footer - Inside export container for inclusion in PDF/Word */}
                  <div
                    data-pdf-page-number={String(finalDocumentPageNumber)}
                    data-pdf-page-kind="footer"
                    className="p-16 bg-[#F5F5F5] border-t border-[#141414] flex flex-col md:flex-row justify-between items-center gap-8 w-full"
                  >
                    <div className="flex items-center gap-4">
                      <div className="w-10 h-10 rounded-full bg-green-100 flex items-center justify-center">
                        <CheckCircle2 className="text-green-600" size={20} />
                      </div>
                      <div className="flex flex-col">
                        <span className="text-[10px] uppercase font-bold tracking-widest">Synthesis Verified</span>
                        <span className="text-[9px] opacity-50 font-mono text-left">Engine v2.5 • Evolutionary Pass Complete</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-4">
                      <a 
                        href="#top"
                        data-pdf-target-page={1}
                        onClick={(e) => { e.preventDefault(); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
                        className="text-[10px] uppercase font-bold hover:underline flex items-center gap-2"
                        title="Scroll back to the top of the document"
                      >
                        Back to Top
                      </a>
                    </div>
                    <div className="text-[10px] font-mono opacity-40">PAGE {finalDocumentPageNumber}</div>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </main>

      <AnimatePresence>
        {showArtifacts && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowArtifacts(false)}
              className="fixed inset-0 bg-[#141414]/40 backdrop-blur-sm z-[100]"
              data-html2canvas-ignore="true"
              title="Close panel"
            />
            <motion.aside
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              className="fixed right-0 top-0 bottom-0 w-full max-w-xl bg-[#E4E3E0] border-l border-[#141414] z-[101] shadow-2xl flex flex-col"
              data-html2canvas-ignore="true"
            >
              <div className="p-6 border-b border-[#141414] flex items-start justify-between gap-4 bg-white">
                <div>
                  <h2 className="text-lg font-serif italic font-bold flex items-center gap-2">
                    <Cpu size={20} /> Processing Artifacts
                  </h2>
                  <p className="mt-1 text-[10px] uppercase tracking-widest opacity-50">
                    Search intake, evolved candidates, and assembly output in one side panel.
                  </p>
                </div>
                <button
                  id="close-artifacts-btn"
                  onClick={() => setShowArtifacts(false)}
                  className="p-2 hover:bg-[#F5F5F5] rounded-full transition-colors"
                  aria-label="Close artifacts panel"
                  title="Close artifacts panel"
                >
                  <X size={20} />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-6 space-y-4">
                {!hasArtifacts ? (
                  <div className="h-full flex flex-col items-center justify-center opacity-40 text-center px-6">
                    <Cpu size={48} />
                    <p className="mt-4 font-serif italic text-xl">No artifacts captured yet</p>
                    <p className="mt-2 text-sm leading-relaxed max-w-sm">
                      Run a search and this panel will preserve the latest search, evolution, and assembly outputs without changing the main layout.
                    </p>
                  </div>
                ) : (
                  <>
                    <section className="bg-white border border-[#141414] p-4 shadow-[4px_4px_0px_0px_rgba(20,20,20,1)]">
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <p className="text-[10px] uppercase font-bold tracking-widest opacity-50">Last Captured Query</p>
                          <h3 className="mt-2 font-serif italic text-xl leading-tight">{artifacts.query || "Untitled Run"}</h3>
                        </div>
                        <span className="text-[9px] uppercase font-bold tracking-widest px-2 py-1 border border-[#141414] bg-[#F5F5F5]">
                          {artifacts.updatedAt ? new Date(artifacts.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : "Pending"}
                        </span>
                      </div>
                      <p className="mt-3 text-[10px] leading-relaxed opacity-60">
                        Sources used: {artifactSourceSummary || "No sources recorded"}
                      </p>
                      <div className="mt-4 grid grid-cols-2 gap-3">
                        <div className="border border-[#141414]/10 bg-[#F8F8F8] p-3">
                          <span className="block text-[9px] uppercase opacity-50 mb-1">Current Stage</span>
                          <span className="text-[11px] uppercase font-bold tracking-widest">{artifactStatusLabel}</span>
                        </div>
                        <div className="border border-[#141414]/10 bg-[#F8F8F8] p-3">
                          <span className="block text-[9px] uppercase opacity-50 mb-1">Elapsed</span>
                          <span className="text-[11px] font-mono font-bold">{artifactElapsedTime}</span>
                        </div>
                      </div>
                    </section>

                    <section className="grid grid-cols-2 gap-3">
                      <div className="bg-white border border-[#141414] p-4">
                        <span className="block text-[9px] uppercase opacity-50 mb-1">Search Results</span>
                        <span className="text-2xl font-mono font-bold">{artifacts.searchResults.length}</span>
                      </div>
                      <div className="bg-white border border-[#141414] p-4">
                        <span className="block text-[9px] uppercase opacity-50 mb-1">Evolved Nodes</span>
                        <span className="text-2xl font-mono font-bold">{artifacts.evolvedPopulation.length}</span>
                      </div>
                      <div className="bg-white border border-[#141414] p-4">
                        <span className="block text-[9px] uppercase opacity-50 mb-1">Providers Seen</span>
                        <span className="text-2xl font-mono font-bold">{Object.keys(artifactProviderSummary).length}</span>
                      </div>
                      <div className="bg-white border border-[#141414] p-4">
                        <span className="block text-[9px] uppercase opacity-50 mb-1">Chapters Built</span>
                        <span className="text-2xl font-mono font-bold">{artifacts.assembledBook?.chapters.length || 0}</span>
                      </div>
                    </section>

                    {artifacts.error && (
                      <section className="bg-red-50 border border-red-200 p-4 text-red-700">
                        <div className="flex items-start gap-3">
                          <AlertCircle size={16} className="mt-0.5 shrink-0" />
                          <div>
                            <p className="text-[10px] uppercase font-bold tracking-widest">Latest Run Error</p>
                            <p className="mt-2 text-sm leading-relaxed">{artifacts.error}</p>
                          </div>
                        </div>
                      </section>
                    )}

                    <details open className="bg-white border border-[#141414] p-4">
                      <summary 
                        id="artifacts-search-intake-summary"
                        className="cursor-pointer list-none flex items-center justify-between gap-3"
                        title="Click to expand or collapse search intake details"
                      >
                        <div>
                          <h3 className="text-sm uppercase font-bold tracking-widest">Search Intake</h3>
                          <p className="mt-1 text-[10px] opacity-60">Results grouped by primary provider. Merged items keep all contributing badges.</p>
                        </div>
                        <span className="text-[10px] uppercase font-bold">{artifacts.searchResults.length} items</span>
                      </summary>
                      <div className="mt-4 space-y-4">
                        {artifacts.providerStatuses.length > 0 && (
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            {artifacts.providerStatuses.map((providerStatus) => (
                              <div key={providerStatus.provider} className="border border-[#141414]/10 bg-[#F8F8F8] p-3">
                                <div className="flex items-center justify-between gap-3">
                                  <span className="text-[10px] uppercase font-bold tracking-widest">{providerStatus.label}</span>
                                  <span
                                    className={`px-2 py-1 text-[9px] uppercase font-bold tracking-widest border ${
                                      providerStatus.status === 'error'
                                        ? 'border-red-200 bg-red-50 text-red-700'
                                        : providerStatus.status === 'complete'
                                          ? 'border-green-200 bg-green-50 text-green-700'
                                          : providerStatus.status === 'queued'
                                            ? 'border-[#141414]/10 bg-white text-[#141414]/50'
                                            : 'border-blue-200 bg-blue-50 text-blue-700'
                                    }`}
                                  >
                                    {providerStatus.status}
                                  </span>
                                </div>
                                <p className="mt-2 text-[11px] font-mono opacity-70">
                                  {providerStatus.resultCount} results
                                </p>
                                {providerStatus.error && (
                                  <p className="mt-2 text-[11px] leading-relaxed text-red-600">
                                    {providerStatus.error}
                                  </p>
                                )}
                              </div>
                            ))}
                          </div>
                        )}

                        {artifactProviderGroups.length === 0 ? (
                          <div className="border border-dashed border-[#141414]/20 bg-[#F8F8F8] p-4">
                            <p className="text-sm opacity-70">
                              {artifacts.status === 'searching'
                                ? artifacts.sourceConfig.executionMode === 'parallel'
                                  ? 'Search intake is running in parallel. Active providers will resolve independently as each source returns.'
                                  : 'Search intake is running sequentially. The active provider will update first, then the next queued source will begin.'
                                : 'No search results captured for this run.'}
                            </p>
                          </div>
                        ) : (
                          artifactProviderGroups.map(([provider, results]) => (
                            <div key={provider} className="border border-[#141414]/10 bg-[#F8F8F8] p-3">
                              <div className="flex items-center justify-between gap-3 pb-3 border-b border-[#141414]/10">
                                <span className="text-[10px] uppercase font-bold tracking-widest">{getProviderLabel(provider)}</span>
                                <span className="text-[10px] font-mono">{results.length}</span>
                              </div>
                              <div className="mt-3 space-y-3">
                                {results.map((result) => {
                                  const providers = result.searchProviders && result.searchProviders.length > 0
                                    ? result.searchProviders
                                    : (result.searchProvider ? [result.searchProvider] : []);

                                  return (
                                    <article key={result.id} className="bg-white border border-[#141414]/10 p-3">
                                      <div className="flex items-start justify-between gap-3">
                                        <div>
                                          <h4 className="font-bold text-sm leading-snug">{result.title}</h4>
                                          <a
                                            id={`artifact-source-link-${result.id}`}
                                            href={result.url}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="mt-1 inline-flex items-center gap-2 text-[11px] font-mono break-all hover:underline"
                                            title={`Visit source: ${result.url}`}
                                          >
                                            <ExternalLink size={12} />
                                            {result.url}
                                          </a>
                                        </div>
                                        <div className="flex flex-wrap justify-end gap-1">
                                          {providers.map((providerName) => (
                                            <span
                                              key={`${result.id}-${providerName}`}
                                              className="px-2 py-1 text-[9px] uppercase font-bold tracking-widest border border-[#141414]/10 bg-[#F5F5F5]"
                                            >
                                              {getProviderLabel(providerName)}
                                            </span>
                                          ))}
                                        </div>
                                      </div>
                                      <p className="mt-3 text-sm leading-relaxed opacity-80">
                                        {truncateText(result.content, 260) || "No content preview available."}
                                      </p>
                                      <div className="mt-3 flex flex-wrap gap-3 text-[10px] uppercase font-bold tracking-widest opacity-50">
                                        <span>{result.definitions.length} definitions</span>
                                        <span>{result.subTopics.length} sub-topics</span>
                                      </div>
                                    </article>
                                  );
                                })}
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    </details>

                    <details className="bg-white border border-[#141414] p-4">
                      <summary 
                        id="artifacts-evolution-pool-summary"
                        className="cursor-pointer list-none flex items-center justify-between gap-3"
                        title="Click to expand or collapse evolution pool details"
                      >
                        <div>
                          <h3 className="text-sm uppercase font-bold tracking-widest">Evolution Pool</h3>
                          <p className="mt-1 text-[10px] opacity-60">Inspect the ranked population after the evolutionary pass.</p>
                        </div>
                        <span className="text-[10px] uppercase font-bold">{artifacts.evolvedPopulation.length} items</span>
                      </summary>
                      <div className="mt-4 space-y-3">
                        {artifacts.evolvedPopulation.length === 0 ? (
                          <p className="text-sm opacity-50">
                            {artifacts.status === 'searching'
                              ? 'Waiting for search intake to finish before evolution begins.'
                              : artifacts.status === 'evolving'
                                ? 'Evolution is running now. Ranked candidates will appear here when the pass completes.'
                                : 'Evolution has not produced a captured population for this run yet.'}
                          </p>
                        ) : (
                          artifacts.evolvedPopulation.map((result) => {
                            const providers = result.searchProviders && result.searchProviders.length > 0
                              ? result.searchProviders
                              : (result.searchProvider ? [result.searchProvider] : []);

                            return (
                              <article key={result.id} className="border border-[#141414]/10 bg-[#F8F8F8] p-3">
                                <div className="flex items-start justify-between gap-3">
                                  <div>
                                    <h4 className="font-bold text-sm leading-snug">{result.title}</h4>
                                    <p className="mt-2 text-sm leading-relaxed opacity-80">
                                      {truncateText(result.content, 220) || "No content preview available."}
                                    </p>
                                  </div>
                                  <span className="px-2 py-1 text-[10px] uppercase font-bold tracking-widest border border-[#141414] bg-white">
                                    F {Number(result.fitness || 0).toFixed(3)}
                                  </span>
                                </div>
                                <div className="mt-3 flex flex-wrap gap-2 text-[10px] uppercase font-bold tracking-widest opacity-60">
                                  <span>I {Number(result.informativeScore || 0).toFixed(3)}</span>
                                  <span>A {Number(result.authorityScore || 0).toFixed(3)}</span>
                                  <span>{result.definitions.length} definitions</span>
                                  <span>{result.subTopics.length} sub-topics</span>
                                  {providers.map((providerName) => (
                                    <span key={`${result.id}-evolved-${providerName}`}>{getProviderLabel(providerName)}</span>
                                  ))}
                                </div>
                              </article>
                            );
                          })
                        )}
                      </div>
                    </details>

                    <details className="bg-white border border-[#141414] p-4">
                      <summary 
                        id="artifacts-assembly-output-summary"
                        className="cursor-pointer list-none flex items-center justify-between gap-3"
                        title="Click to expand or collapse assembly output details"
                      >
                        <div>
                          <h3 className="text-sm uppercase font-bold tracking-widest">Assembly Output</h3>
                          <p className="mt-1 text-[10px] opacity-60">Review the current Web-book structure captured after assembly.</p>
                        </div>
                        <span className="text-[10px] uppercase font-bold">{artifacts.assembledBook?.chapters.length || 0} chapters</span>
                      </summary>
                      <div className="mt-4 space-y-3">
                        {!artifacts.assembledBook ? (
                          <p className="text-sm opacity-50">
                            {artifacts.status === 'searching' || artifacts.status === 'evolving'
                              ? 'Assembly will begin after the evolutionary pass completes.'
                              : artifacts.status === 'assembling'
                                ? 'Assembly is in progress. Chapter artifacts will appear here once the Web-book is built.'
                                : 'No assembled Web-book has been captured yet.'}
                          </p>
                        ) : (
                          artifacts.assembledBook.chapters.map((chapter, index) => (
                            <article key={`${artifacts.assembledBook?.id || 'book'}-${index}`} className="border border-[#141414]/10 bg-[#F8F8F8] p-3">
                              <div className="flex items-start justify-between gap-3">
                                <div>
                                  <span className="block text-[9px] uppercase font-bold tracking-widest opacity-50">Chapter {index + 1}</span>
                                  <h4 className="mt-1 font-bold text-sm leading-snug">{chapter.title}</h4>
                                </div>
                                <span className="px-2 py-1 text-[9px] uppercase font-bold tracking-widest border border-[#141414]/10 bg-white">
                                  {chapter.sourceUrls.length} sources
                                </span>
                              </div>
                              <p className="mt-3 text-sm leading-relaxed opacity-80">
                                {truncateText(chapter.content, 220) || "No chapter summary available."}
                              </p>
                              <div className="mt-3 flex flex-wrap gap-3 text-[10px] uppercase font-bold tracking-widest opacity-50">
                                <span>{chapter.definitions.length} definitions</span>
                                <span>{chapter.subTopics.length} sub-topics</span>
                                <span>Visual seed: {chapter.visualSeed || "n/a"}</span>
                              </div>
                            </article>
                          ))
                        )}
                      </div>
                    </details>

                    {manualArtifacts.length > 0 && (
                      <details className="bg-white border border-[#141414] p-4">
                        <summary 
                          id="artifacts-manual-source-fetches-summary"
                          className="cursor-pointer list-none flex items-center justify-between gap-3"
                          title="Click to expand or collapse manual source fetch details"
                        >
                          <div>
                            <h3 className="text-sm uppercase font-bold tracking-widest">Manual Source Fetches</h3>
                            <p className="mt-1 text-[10px] opacity-60">Results gathered directly from user-provided URLs.</p>
                          </div>
                          <span className="text-[10px] uppercase font-bold">{manualArtifacts.length} items</span>
                        </summary>
                        <div className="mt-4 space-y-3">
                          {manualArtifacts.map((result) => (
                            <article key={`${result.id}-manual`} className="border border-[#141414]/10 bg-[#F8F8F8] p-3">
                              <h4 className="font-bold text-sm leading-snug">{result.title}</h4>
                              <a
                                href={result.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="mt-2 inline-flex items-center gap-2 text-[11px] font-mono break-all hover:underline"
                                title={`Visit source: ${result.url}`}
                              >
                                <ExternalLink size={12} />
                                {result.url}
                              </a>
                              <p className="mt-3 text-sm leading-relaxed opacity-80">
                                {truncateText(result.content, 240) || "No content preview available."}
                              </p>
                            </article>
                          ))}
                        </div>
                      </details>
                    )}

                    <details className="bg-white border border-[#141414] p-4">
                      <summary 
                        id="artifacts-json-snapshot-summary"
                        className="cursor-pointer list-none flex items-center justify-between gap-3"
                        title="Click to expand or collapse JSON snapshot"
                      >
                        <div>
                          <h3 className="text-sm uppercase font-bold tracking-widest">JSON Snapshot</h3>
                          <p className="mt-1 text-[10px] opacity-60">Compact debugging payload for the latest captured run.</p>
                        </div>
                        <span className="text-[10px] uppercase font-bold">Raw</span>
                      </summary>
                      <pre className="mt-4 max-h-80 overflow-auto bg-[#141414] text-[#E4E3E0] p-4 text-[11px] leading-relaxed font-mono">
                        {formatJson({
                          status: artifacts.status,
                          query: artifacts.query,
                          sourceConfig: artifacts.sourceConfig,
                          searchResults: artifacts.searchResults,
                          evolvedPopulation: artifacts.evolvedPopulation,
                          assembledBook: artifacts.assembledBook,
                          startedAt: artifacts.startedAt,
                          updatedAt: artifacts.updatedAt,
                          error: artifacts.error,
                          providerStatuses: artifacts.providerStatuses,
                        })}
                      </pre>
                    </details>
                  </>
                )}
              </div>
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      {/* History Sidebar/Modal Overlay */}
      <AnimatePresence>
        {showHistory && (
          <>
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowHistory(false)}
              className="fixed inset-0 bg-[#141414]/40 backdrop-blur-sm z-[100]"
              data-html2canvas-ignore="true"
              title="Close panel"
            />
            <motion.div 
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              className="fixed right-0 top-0 bottom-0 w-full max-w-md bg-[#E4E3E0] border-l border-[#141414] z-[101] shadow-2xl flex flex-col"
              data-html2canvas-ignore="true"
            >
              <div className="p-6 border-b border-[#141414] flex justify-between items-center bg-white">
                <h2 className="text-lg font-serif italic font-bold flex items-center gap-2">
                  <History size={20} /> Archive & History
                </h2>
                <button 
                  id="close-history-btn"
                  onClick={() => setShowHistory(false)} 
                  className="p-2 hover:bg-[#F5F5F5] rounded-full transition-colors"
                  title="Close history panel"
                >
                  <X size={20} />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-6 space-y-4">
                {history.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center opacity-30 text-center">
                    <Clock size={48} />
                    <p className="mt-4 font-serif italic">No archived Web-books found</p>
                  </div>
                ) : (
                  history.map((item) => (
                    <div 
                      id={`history-item-${item.id}`}
                      key={item.id}
                      className="bg-white border border-[#141414] p-4 shadow-[4px_4px_0px_0px_rgba(20,20,20,1)] hover:translate-x-1 hover:translate-y-1 hover:shadow-none transition-all group relative"
                    >
                      <div className="flex justify-between items-start mb-2">
                        <span className="text-[9px] uppercase font-mono opacity-50">
                          {new Date(item.timestamp).toLocaleDateString()} • {new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                        <button 
                          id={`delete-history-item-${item.id}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            deleteHistoryItem(item.id);
                          }}
                          className="text-red-600 opacity-0 group-hover:opacity-100 transition-opacity p-1 hover:bg-red-50 rounded"
                          title="Permanently delete this item from history"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                      <h3 className="font-serif italic font-bold text-lg leading-tight mb-3">{item.topic}</h3>
                      <div className="flex justify-between items-center">
                        <span className="text-[10px] uppercase font-bold opacity-60">{item.chapters.length} Chapters</span>
                        <button 
                          id={`view-history-item-${item.id}`}
                          onClick={() => viewHistoryItem(item)}
                          className="text-[10px] uppercase font-bold flex items-center gap-1 hover:underline"
                          title="Load this Web-book from the archive"
                        >
                          View Book <ChevronRight size={12} />
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>

              {history.length > 0 && (
                <div className="p-6 border-t border-[#141414] bg-white">
                  <button 
                    id="clear-all-history-btn"
                    onClick={clearAllHistory}
                    className="w-full py-3 border border-red-600 text-red-600 text-[11px] uppercase font-bold tracking-widest hover:bg-red-600 hover:text-white transition-all"
                    title="Permanently delete all items from history"
                  >
                    Clear All History
                  </button>
                </div>
              )}
            </motion.div>
          </>
        )}
      </AnimatePresence>

      <footer className="mt-20 border-t border-[#141414] p-10 text-center opacity-40 print:hidden">
        <p className="text-[10px] uppercase tracking-[0.5em]">Architecting an Evolutionary Web-Book Engine © 2026</p>
        <p className="text-[9px] mt-2">Hock Chiye Er</p>
      </footer>
    </div>
  );
}
