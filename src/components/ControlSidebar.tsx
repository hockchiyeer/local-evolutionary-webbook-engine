import { useEffect, useRef, type FormEvent } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { AlertCircle, Cpu, Dna, ExternalLink, Info, Layers, Loader2, Plus, Search, Trash2, X } from 'lucide-react';
import type { EvolutionState, SearchExecutionMode, SearchSourceConfig, SearchSourceKey, WebPageGenotype } from '../types';
import type { ArtifactProviderStatus, ArtifactsState } from '../hooks/useWebBookEngine';
import { EXECUTION_MODE_CARDS, SOURCE_PORTAL_CARDS } from '../hooks/useWebBookEngine';

type PipelineStageState = 'idle' | 'queued' | 'active' | 'complete' | 'error';

interface ControlSidebarProps {
  query: string;
  onQueryChange: (value: string) => void;
  state: EvolutionState;
  error: string | null;
  notice: string | null;
  artifacts: ArtifactsState;
  runtimeMs: number | null;
  showArtifacts: boolean;
  onToggleArtifacts: () => void;
  onSearch: () => Promise<void>;
  onStartNewSearch: () => void;
  sourceConfig: SearchSourceConfig;
  manualSourceInput: string;
  setManualSourceInput: (value: string) => void;
  toggleBuiltInSource: (sourceKey: SearchSourceKey) => void;
  setAllBuiltInSources: (enabled: boolean) => void;
  setExecutionMode: (mode: SearchExecutionMode) => void;
  addManualSources: () => void;
  removeManualSource: (url: string) => void;
}

const PROVIDER_STATUS_LABELS: Record<ArtifactProviderStatus['status'], string> = {
  queued: 'Queued',
  running: 'Running',
  complete: 'Complete',
  error: 'Issue',
};

const PIPELINE_STATUS_LABELS: Record<PipelineStageState, string> = {
  idle: 'Idle',
  queued: 'Queued',
  active: 'Running',
  complete: 'Complete',
  error: 'Issue',
};

const formatDuration = (ms: number | null | undefined) => {
  if (!ms || ms <= 0) return 'Just started';
  const totalSeconds = Math.max(1, Math.round(ms / 1000));
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return seconds ? `${minutes}m ${seconds}s` : `${minutes}m`;
};

const statusTone = (status?: ArtifactProviderStatus['status']) => {
  switch (status) {
    case 'running':
      return 'border-[#1f4d72] bg-[#e4f2fb] text-[#17405f]';
    case 'complete':
      return 'border-[#245c39] bg-[#e8f6ea] text-[#1f4f31]';
    case 'error':
      return 'border-[#8c2f2f] bg-[#fdecec] text-[#7a2727]';
    case 'queued':
      return 'border-[#9d7d56] bg-[#f2e5d1] text-[#6c5236]';
    default:
      return 'border-[#d9cfbf] bg-[#f6f0e5] text-[#7a6c5a]';
  }
};

const stageTone = (status: PipelineStageState) => {
  switch (status) {
    case 'active':
      return 'border-[#17405f] bg-[#eff7fd]';
    case 'complete':
      return 'border-[#1f4f31] bg-[#eef8f0]';
    case 'error':
      return 'border-[#7a2727] bg-[#fff1f1]';
    case 'queued':
      return 'border-[#9d7d56] bg-[#fbf4ea]';
    default:
      return 'border-[#ded4c7] bg-[#fffdf8]';
  }
};

const summarizeProviders = (result: WebPageGenotype) => {
  const providers = result.searchProviders?.length ? result.searchProviders : [result.searchProvider];
  return providers.filter(Boolean).join(' | ') || 'source';
};

export function ControlSidebar({
  query,
  onQueryChange,
  state,
  error,
  notice,
  artifacts,
  runtimeMs,
  showArtifacts,
  onToggleArtifacts,
  onSearch,
  onStartNewSearch,
  sourceConfig,
  manualSourceInput,
  setManualSourceInput,
  toggleBuiltInSource,
  setAllBuiltInSources,
  setExecutionMode,
  addManualSources,
  removeManualSource,
}: ControlSidebarProps) {
  const artifactsRef = useRef<HTMLElement>(null);
  const isBusy = state.status !== 'idle' && state.status !== 'complete';
  const totalEnabledSourceCount = Object.values(sourceConfig.sources).filter(Boolean).length + sourceConfig.manualUrls.length;
  const frontierCount = artifacts.searchResults.length;
  const evolvedCount = artifacts.evolvedPopulation.length;
  const chapterCount = artifacts.assembledBook?.chapters.length ?? 0;
  const completedProviders = artifacts.providerStatuses.filter((status) => status.status === 'complete' || status.status === 'error').length;
  const bestFitness = state.bestFitness || Math.max(0, ...state.population.map((candidate) => candidate.fitness || 0));
  const providerStatusMap = new Map(artifacts.providerStatuses.map((status) => [status.provider, status]));
  const manualStatus = providerStatusMap.get('manual');
  const supplementalStatuses = artifacts.providerStatuses.filter(
    (status) => !SOURCE_PORTAL_CARDS.some((card) => card.key === status.provider) && status.provider !== 'manual',
  );

  useEffect(() => {
    if (!showArtifacts || !artifactsRef.current) return;
    const timer = window.setTimeout(() => {
      artifactsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 120);
    return () => window.clearTimeout(timer);
  }, [showArtifacts]);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    await onSearch();
  };

  const searchStage: PipelineStageState = artifacts.status === 'error' && frontierCount === 0
    ? 'error'
    : state.status === 'searching'
      ? 'active'
      : (frontierCount > 0 || state.status === 'evolving' || state.status === 'assembling' || state.status === 'complete')
        ? 'complete'
        : 'idle';

  const evolveStage: PipelineStageState = artifacts.status === 'error' && frontierCount > 0 && evolvedCount === 0
    ? 'error'
    : state.status === 'evolving'
      ? 'active'
      : (evolvedCount > 0 || state.status === 'assembling' || state.status === 'complete')
        ? 'complete'
        : state.status === 'searching'
          ? 'queued'
          : 'idle';

  const assembleStage: PipelineStageState = artifacts.status === 'error' && evolvedCount > 0 && chapterCount === 0
    ? 'error'
    : state.status === 'assembling'
      ? 'active'
      : (chapterCount > 0 || state.status === 'complete')
        ? 'complete'
        : (state.status === 'searching' || state.status === 'evolving')
          ? 'queued'
          : 'idle';

  const stages = [
    {
      key: 'search',
      label: 'Source Discovery',
      detail: 'Live retrieval, metadata intake, dedupe, semantic filtering, and excerpt enrichment.',
      metric: artifacts.providerStatuses.length ? `${completedProviders}/${artifacts.providerStatuses.length} lanes resolved` : 'Waiting for launch',
      icon: Search,
      state: searchStage,
    },
    {
      key: 'evolve',
      label: 'Evolutionary Selection',
      detail: 'Feature scoring, redundancy penalties, crossover, mutation, and ranked source selection.',
      metric: evolvedCount ? `${evolvedCount} ranked candidates` : (frontierCount ? `${frontierCount} frontier candidates ready` : 'Waiting for frontier'),
      icon: Dna,
      state: evolveStage,
    },
    {
      key: 'assemble',
      label: 'NLP Book Assembly',
      detail: 'Cluster-aware chapter shaping, semantic title paths, and sentence-level micro-GA assembly.',
      metric: chapterCount ? `${chapterCount} chapters assembled` : (evolvedCount ? 'Assembly in progress' : 'Waiting for evolved frontier'),
      icon: Cpu,
      state: assembleStage,
    },
  ];

  return (
    <div data-html2canvas-ignore="true" className="lg:col-span-4 space-y-6 print:hidden">
      <section className="rounded-[28px] border border-[#1f1a14] bg-[linear-gradient(180deg,#fffef8_0%,#f3eadc_100%)] p-6 shadow-[0_24px_60px_-34px_rgba(34,24,12,0.45)]">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.34em] text-[#7b6e5d]">WebBook Studio</p>
            <p className="mt-3 max-w-md text-sm leading-6 text-[#5d5245]">Set the prompt, evidence blend, and runtime behavior for the next synthesis.</p>
          </div>
          <button
            onClick={onStartNewSearch}
            className="shrink-0 rounded-full border border-[#1d1710] px-4 py-2 text-[10px] font-bold uppercase tracking-[0.22em] text-[#1d1710] transition hover:bg-[#1d1710] hover:text-[#fffaf2]"
          >
            <span className="inline-flex items-center gap-1.5"><Plus size={12} />New Search</span>
          </button>
        </div>

        <form onSubmit={(event) => void handleSubmit(event)} className="mt-6 space-y-3">
          <label className="block text-[11px] font-semibold uppercase tracking-[0.28em] text-[#7b6e5d]">Reading Prompt</label>
          <div className="relative">
            <textarea
              rows={4}
              value={query}
              onChange={(event) => onQueryChange(event.target.value)}
              placeholder="Enter a topic, person, book, research theme, market, historical event, or technical subject..."
              className="min-h-[140px] w-full rounded-[22px] border border-[#1f1a14] bg-[#fffdf7] px-5 py-4 pr-16 text-base leading-7 text-[#1d1710] shadow-inner focus:outline-none focus:ring-2 focus:ring-[#b68c55] disabled:cursor-not-allowed disabled:opacity-70"
              disabled={isBusy}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  void onSearch();
                }
              }}
            />
            <button
              type="submit"
              className="absolute bottom-4 right-4 flex h-11 w-11 items-center justify-center rounded-full bg-[#1d1710] text-[#fffaf2] transition hover:bg-[#2f261c] disabled:cursor-not-allowed disabled:opacity-60"
              disabled={isBusy}
            >
              {isBusy ? <Loader2 size={18} className="animate-spin" /> : <Search size={18} />}
            </button>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-[minmax(0,0.85fr)_minmax(8.75rem,1.15fr)_minmax(0,0.95fr)]">
            <div className="min-w-0 rounded-[18px] border border-[#d8cbb7] bg-[#fffdf7] p-4">
              <div className="text-[10px] uppercase tracking-[0.24em] text-[#8a7b67]">Sources</div>
              <div className="mt-2 text-2xl font-semibold text-[#1d1710]">{totalEnabledSourceCount}</div>
            </div>
            <div className="min-w-0 rounded-[18px] border border-[#d8cbb7] bg-[#fffdf7] p-4">
              <div className="text-[10px] uppercase tracking-[0.24em] text-[#8a7b67]">Mode</div>
              <div className="mt-2 min-w-0 whitespace-nowrap text-[15px] font-semibold leading-tight text-[#1d1710] sm:text-base">
                {sourceConfig.executionMode.toUpperCase()}
              </div>
            </div>
            <div className="col-span-2 min-w-0 rounded-[18px] border border-[#d8cbb7] bg-[#fffdf7] p-4 sm:col-span-1">
              <div className="text-[10px] uppercase tracking-[0.24em] text-[#8a7b67]">Elapsed</div>
              <div className="mt-2 min-w-0 text-base font-semibold leading-tight text-[#1d1710] sm:text-lg">{runtimeMs ? formatDuration(runtimeMs) : 'Not started'}</div>
            </div>
          </div>
        </form>
      </section>

      <section className="rounded-[28px] border border-[#d7cbbb] bg-[#fffef9] p-6 shadow-[0_18px_46px_-34px_rgba(44,31,17,0.42)]">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.32em] text-[#8a7b67]">Source Portfolio</p>
            <h3 className="mt-2 font-serif text-[1.7rem] leading-none text-[#1d1710]">Control the evidence blend</h3>
          </div>
          <div className="rounded-full border border-[#cdbfae] bg-[#f7efe2] px-3 py-1 text-[10px] uppercase tracking-[0.24em] text-[#6b5b4a]">{totalEnabledSourceCount} active</div>
        </div>

        <div className="mt-5 grid grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-3">
          {SOURCE_PORTAL_CARDS.map((source) => {
            const checked = sourceConfig.sources[source.key];
            const progress = providerStatusMap.get(source.key);
            return (
              <article key={source.key} className={`overflow-hidden rounded-[22px] border p-4 ${checked ? 'border-[#1f1a14] bg-[#1f1a14] text-[#fffaf2]' : 'border-[#d8ccbd] bg-[#fcf7ef] text-[#1d1710]'}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className={`text-[10px] uppercase tracking-[0.24em] ${checked ? 'text-[#d2c4af]' : 'text-[#8b7b68]'}`}>{source.category}</div>
                    <h4 className="mt-2 break-words text-lg font-semibold">{source.label}</h4>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={checked}
                    disabled={isBusy}
                    onClick={() => toggleBuiltInSource(source.key)}
                    className={`mt-1 inline-flex h-6 w-11 shrink-0 items-center rounded-full border p-[3px] transition-colors ${
                      checked
                        ? 'justify-end border-[#d4c5b3] bg-[#f6ede1]'
                        : 'justify-start border-[#b8a792] bg-[#ece3d7]'
                    } ${isBusy ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}
                  >
                    <span
                      className={`block h-4 w-4 rounded-full transition-colors ${
                        checked ? 'bg-[#1d1710]' : 'bg-[#9b8b77]'
                      }`}
                    />
                  </button>
                </div>

                <p className={`mt-3 text-sm leading-6 ${checked ? 'text-[#f5ebdc]' : 'text-[#5f5448]'}`}>{source.description}</p>
                <p className={`mt-3 text-[12px] leading-5 ${checked ? 'text-[#dbcbb6]' : 'text-[#7a6b58]'}`}>{source.usage}</p>

                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <span className={`rounded-full border px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] ${statusTone(progress?.status)}`}>
                    {progress ? PROVIDER_STATUS_LABELS[progress.status] : (checked ? 'Enabled' : 'Disabled')}
                  </span>
                  {progress && (
                    <span className={`rounded-full border px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] ${checked ? 'border-white/15 bg-white/5 text-[#f6ecde]' : 'border-[#d7cab8] bg-[#fffdf8] text-[#6c5d49]'}`}>
                      {progress.resultCount} hits
                    </span>
                  )}
                </div>

                {progress && (
                  <div className={`mt-4 grid grid-cols-2 gap-2 text-[11px] ${checked ? 'text-[#f5ebdc]' : 'text-[#5f5448]'}`}>
                    <div className={`rounded-[16px] border px-3 py-2 ${checked ? 'border-white/12 bg-white/6' : 'border-[#e0d5c7] bg-white/80'}`}>frontier {progress.frontierCount}</div>
                    <div className={`rounded-[16px] border px-3 py-2 ${checked ? 'border-white/12 bg-white/6' : 'border-[#e0d5c7] bg-white/80'}`}>{formatDuration(progress.durationMs)}</div>
                  </div>
                )}
              </article>
            );
          })}
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" onClick={() => setAllBuiltInSources(true)} disabled={isBusy} className="rounded-full border border-[#1d1710] px-4 py-2 text-[10px] uppercase tracking-[0.22em] text-[#1d1710] transition hover:bg-[#1d1710] hover:text-[#fffaf2] disabled:opacity-50">All On</button>
          <button type="button" onClick={() => setAllBuiltInSources(false)} disabled={isBusy} className="rounded-full border border-[#c9baa7] px-4 py-2 text-[10px] uppercase tracking-[0.22em] text-[#6b5b4a] transition hover:border-[#1d1710] hover:text-[#1d1710] disabled:opacity-50">All Off</button>
        </div>

        <div className="mt-6 rounded-[22px] border border-[#e0d5c7] bg-[#fcf7ef] p-4">
          <div className="text-[10px] uppercase tracking-[0.24em] text-[#8a7b67]">Execution Mode</div>
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {EXECUTION_MODE_CARDS.map((mode) => {
              const selected = sourceConfig.executionMode === mode.key;
              return (
                <button
                  key={mode.key}
                  type="button"
                  onClick={() => setExecutionMode(mode.key)}
                  disabled={isBusy}
                  className={`min-w-0 rounded-[18px] border p-4 text-left ${selected ? 'border-[#1d1710] bg-[#1d1710] text-[#fffaf2]' : 'border-[#d8ccbd] bg-[#fffdf8] text-[#1d1710]'} disabled:opacity-60`}
                >
                  <div className={`break-words text-[10px] uppercase tracking-[0.22em] ${selected ? 'text-[#d5c8b5]' : 'text-[#8a7b67]'}`}>{mode.label}</div>
                  <p className={`mt-3 text-sm leading-6 ${selected ? 'text-[#f3e7d7]' : 'text-[#5f5448]'}`}>{mode.description}</p>
                </button>
              );
            })}
          </div>
        </div>

        <div className="mt-6 rounded-[22px] border border-[#e0d5c7] bg-[#fffdf7] p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-[10px] uppercase tracking-[0.24em] text-[#8a7b67]">Manual Sources</div>
              <p className="mt-2 text-sm leading-6 text-[#635847]">Paste direct pages when you want a document guaranteed in the frontier. Up to 12 URLs can be staged.</p>
            </div>
            {manualStatus && (
              <span className={`rounded-full border px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] ${statusTone(manualStatus.status)}`}>
                {PROVIDER_STATUS_LABELS[manualStatus.status]}
              </span>
            )}
          </div>

          <div className="mt-4 flex flex-col gap-3">
            <textarea
              rows={3}
              value={manualSourceInput}
              onChange={(event) => setManualSourceInput(event.target.value)}
              placeholder="https://example.com/article-one https://example.org/report-two"
              disabled={isBusy}
              className="min-h-[96px] w-full rounded-[18px] border border-[#d5c8b5] bg-[#fcf7ef] px-4 py-3 text-sm leading-6 text-[#1d1710] focus:outline-none focus:ring-2 focus:ring-[#b68c55] disabled:opacity-60"
            />
            <button type="button" onClick={addManualSources} disabled={isBusy} className="rounded-full bg-[#1d1710] px-4 py-3 text-[10px] uppercase tracking-[0.22em] text-[#fffaf2] transition hover:bg-[#2f261c] disabled:opacity-60">Add Manual Source</button>
          </div>

          {sourceConfig.manualUrls.length > 0 && (
            <div className="mt-4 space-y-2">
              {sourceConfig.manualUrls.map((url) => (
                <div key={url} className="flex items-center justify-between gap-3 rounded-[16px] border border-[#e2d6c8] bg-[#fcf7ef] px-3 py-3">
                  <a href={url} target="_blank" rel="noopener noreferrer" className="min-w-0 flex-1 break-all text-[11px] leading-5 text-[#1d1710] hover:underline">
                    <span className="inline-flex items-center gap-2"><ExternalLink size={12} className="shrink-0" />{url}</span>
                  </a>
                  <button type="button" onClick={() => removeManualSource(url)} disabled={isBusy} className="rounded-full border border-[#ebc0c0] p-2 text-[#8a2b2b] transition hover:bg-[#fff1f1] disabled:opacity-50">
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {supplementalStatuses.length > 0 && (
          <div className="mt-4 rounded-[20px] border border-[#e0d5c7] bg-[#fffaf3] p-4">
            <div className="text-[10px] uppercase tracking-[0.24em] text-[#8a7b67]">Supplemental Stages</div>
            <div className="mt-3 space-y-2">
              {supplementalStatuses.map((status) => (
                <div key={status.provider} className="rounded-[16px] border border-[#dccfbe] bg-[#fffef9] p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-[#1d1710]">{status.label}</div>
                      <div className="mt-1 text-[11px] leading-5 text-[#6b5b4a]">{status.description}</div>
                    </div>
                    <span className={`rounded-full border px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] ${statusTone(status.status)}`}>
                      {PROVIDER_STATUS_LABELS[status.status]}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      <section className="rounded-[28px] border border-[#d7cbbb] bg-[#fffef9] p-6 shadow-[0_18px_46px_-34px_rgba(44,31,17,0.42)]">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[11px] uppercase tracking-[0.32em] text-[#8a7b67]">Pipeline Atlas</p>
            <h3 className="mt-2 font-serif text-[1.7rem] leading-none text-[#1d1710]">Map the algorithm to the run</h3>
          </div>
          <button
            onClick={onToggleArtifacts}
            className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-[10px] uppercase tracking-[0.22em] transition ${showArtifacts ? 'border-[#1d1710] bg-[#1d1710] text-[#fffaf2]' : 'border-[#1d1710] text-[#1d1710] hover:bg-[#1d1710] hover:text-[#fffaf2]'}`}
          >
            <Layers size={12} />
            {showArtifacts ? 'Hide Artifacts' : 'Show Artifacts'}
          </button>
        </div>

        <div className="mt-5 space-y-3" aria-live="polite">
          {stages.map((stage) => {
            const Icon = stage.icon;
            const chipStatus = stage.state === 'active'
              ? 'running'
              : stage.state === 'complete'
                ? 'complete'
                : stage.state === 'error'
                  ? 'error'
                  : stage.state === 'queued'
                    ? 'queued'
                    : undefined;

            return (
              <article key={stage.key} className={`rounded-[22px] border p-4 ${stageTone(stage.state)}`}>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="inline-flex items-center gap-2 text-[10px] uppercase tracking-[0.22em] text-[#8a7b67]"><Icon size={12} />{stage.label}</div>
                    <p className="mt-3 text-sm leading-6 text-[#3e362b]">{stage.detail}</p>
                    <div className="mt-3 text-[11px] text-[#5c5041]">{stage.metric}</div>
                  </div>
                  <span className={`rounded-full border px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] ${statusTone(chipStatus)}`}>
                    {PIPELINE_STATUS_LABELS[stage.state]}
                  </span>
                </div>
              </article>
            );
          })}
        </div>

        <div className="mt-5 grid grid-cols-2 gap-3">
          <div className="rounded-[18px] border border-[#e1d6c8] bg-[#fcf7ef] p-4"><div className="text-[10px] uppercase tracking-[0.24em] text-[#8a7b67]">Frontier</div><div className="mt-2 text-2xl font-semibold text-[#1d1710]">{frontierCount}</div></div>
          <div className="rounded-[18px] border border-[#e1d6c8] bg-[#fcf7ef] p-4"><div className="text-[10px] uppercase tracking-[0.24em] text-[#8a7b67]">Evolved</div><div className="mt-2 text-2xl font-semibold text-[#1d1710]">{evolvedCount || state.population.length}</div></div>
          <div className="rounded-[18px] border border-[#e1d6c8] bg-[#fcf7ef] p-4"><div className="text-[10px] uppercase tracking-[0.24em] text-[#8a7b67]">Chapters</div><div className="mt-2 text-2xl font-semibold text-[#1d1710]">{chapterCount}</div></div>
          <div className="rounded-[18px] border border-[#e1d6c8] bg-[#fcf7ef] p-4"><div className="text-[10px] uppercase tracking-[0.24em] text-[#8a7b67]">Best Fitness</div><div className="mt-2 text-2xl font-semibold text-[#1d1710]">{bestFitness.toFixed(4)}</div></div>
        </div>

        {notice && (
          <div className="mt-4 rounded-[18px] border border-[#efcc84] bg-[#fff7dd] px-4 py-3 text-sm leading-6 text-[#6d5312]">
            <span className="inline-flex items-start gap-2"><Info size={14} className="mt-1 shrink-0" />{notice}</span>
          </div>
        )}

        {error && (
          <div className="mt-4 rounded-[18px] border border-[#efb8b8] bg-[#fff1f1] px-4 py-3 text-sm leading-6 text-[#7a2727]">
            <span className="inline-flex items-start gap-2"><AlertCircle size={14} className="mt-1 shrink-0" />{error}</span>
          </div>
        )}
      </section>

      <AnimatePresence>
        {showArtifacts && (
          <motion.section
            ref={artifactsRef}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="rounded-[28px] border border-[#1d1710] bg-[#17120d] p-5 text-[#fffaf2]">
              <div className="flex items-center justify-between gap-3 border-b border-white/10 pb-3">
                <div>
                  <div className="text-[10px] uppercase tracking-[0.28em] text-[#c9baa7]">System Artifacts</div>
                  <div className="mt-2 text-lg font-semibold">Frontier, ranked population, and assembly blueprint</div>
                </div>
                <button onClick={onToggleArtifacts} className="rounded-full border border-white/10 p-2 transition hover:bg-white/10">
                  <X size={14} />
                </button>
              </div>

              <div className="mt-5 grid gap-5 text-[11px]">
                <div>
                  <div className="text-[10px] uppercase tracking-[0.24em] text-[#dbcdb9]">Search Frontier</div>
                  <div className="mt-3 space-y-2">
                    {artifacts.searchResults.slice(0, 5).map((result, index) => (
                      <div key={`${result.id}-${index}`} className="rounded-[18px] border border-white/10 bg-white/5 p-3">
                        <div className="font-semibold text-[#fffaf2]">{result.title}</div>
                        <div className="mt-1 text-[10px] uppercase tracking-[0.2em] text-[#cabca8]">{summarizeProviders(result)}</div>
                        <div className="mt-2 leading-5 text-[#e8dccb]">{result.content.slice(0, 160)}{result.content.length > 160 ? '...' : ''}</div>
                      </div>
                    ))}
                    {artifacts.searchResults.length === 0 && <div className="rounded-[18px] border border-dashed border-white/15 px-4 py-3 text-[#cdbfae]">The first live evidence will appear here.</div>}
                  </div>
                </div>

                <div>
                  <div className="text-[10px] uppercase tracking-[0.24em] text-[#dbcdb9]">Ranked Population</div>
                  <div className="mt-3 space-y-2">
                    {artifacts.evolvedPopulation.slice(0, 5).map((result, index) => (
                      <div key={`${result.id}-${index}`} className="rounded-[18px] border border-white/10 bg-white/5 p-3">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="font-semibold text-[#fffaf2]">{result.title}</div>
                            <div className="mt-1 text-[10px] uppercase tracking-[0.2em] text-[#cabca8]">{summarizeProviders(result)}</div>
                          </div>
                          <div className="text-right text-[#fffaf2]">{(result.fitness || 0).toFixed(4)}</div>
                        </div>
                      </div>
                    ))}
                    {artifacts.evolvedPopulation.length === 0 && <div className="rounded-[18px] border border-dashed border-white/15 px-4 py-3 text-[#cdbfae]">Ranked source candidates will appear here after evolution starts.</div>}
                  </div>
                </div>

                <div>
                  <div className="text-[10px] uppercase tracking-[0.24em] text-[#dbcdb9]">Assembly Blueprint</div>
                  <div className="mt-3 space-y-2">
                    {artifacts.assembledBook?.chapters.slice(0, 6).map((chapter, index) => (
                      <div key={`${chapter.id || chapter.title}-${index}`} className="rounded-[18px] border border-white/10 bg-white/5 p-3">
                        <div className="font-semibold text-[#fffaf2]">{chapter.title}</div>
                        <div className="mt-1 text-[10px] uppercase tracking-[0.2em] text-[#cabca8]">{chapter.sourceUrls.length} sources | {chapter.definitions.length} definitions</div>
                        <div className="mt-2 leading-5 text-[#e8dccb]">{chapter.content.slice(0, 160)}{chapter.content.length > 160 ? '...' : ''}</div>
                      </div>
                    ))}
                    {!artifacts.assembledBook && <div className="rounded-[18px] border border-dashed border-white/15 px-4 py-3 text-[#cdbfae]">Chapter structure appears here after assembly completes.</div>}
                  </div>
                </div>
              </div>
            </div>
          </motion.section>
        )}
      </AnimatePresence>
    </div>
  );
}
