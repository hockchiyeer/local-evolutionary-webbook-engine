/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useWebBookEngine } from './hooks/useWebBookEngine';
import { ControlSidebar } from './components/ControlSidebar';
import { AppHeader } from './components/AppHeader';
import { HistoryDrawer } from './components/HistoryDrawer';
import { WebBookViewer } from './components/WebBookViewer';
import { exportWebBookToPdf, printWebBook, exportWebBookToWord, exportWebBookToHtml, exportWebBookToTxt } from './services/exportService';
import { motion, AnimatePresence } from 'motion/react';
import { Infinity as InfinityIcon } from 'lucide-react';
const formatElapsed = (runtimeMs: number | null) => (runtimeMs ? `${Math.max(1, Math.round(runtimeMs / 1000))}s` : '0s');
type LoadingStageState = 'idle' | 'queued' | 'active' | 'complete' | 'error';
const FINAL_ASSEMBLY_STAGE_HOLD_MS = 1800;

export default function App() {
  const engine = useWebBookEngine();
  const [showHistory, setShowHistory] = useState(false);
  const [showArtifacts, setShowArtifacts] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isHoldingStageCompletion, setIsHoldingStageCompletion] = useState(false);
  const [, setTick] = useState(0);
  const previousStatusRef = useRef(engine.state.status);
  const revealTimeoutRef = useRef<number | null>(null);
  const revealedBookIdRef = useRef<string | null>(engine.webBook?.id ?? null);

  useLayoutEffect(() => {
    const previousStatus = previousStatusRef.current;
    const currentStatus = engine.state.status;
    const nextBookId = engine.webBook?.id ?? null;

    if (revealTimeoutRef.current !== null) {
      window.clearTimeout(revealTimeoutRef.current);
      revealTimeoutRef.current = null;
    }

    if (!nextBookId) {
      revealedBookIdRef.current = null;
      setIsHoldingStageCompletion(false);
      previousStatusRef.current = currentStatus;
      return;
    }

    const shouldHoldAssemblyReveal = (
      previousStatus === 'assembling'
      && currentStatus === 'complete'
      && revealedBookIdRef.current !== nextBookId
    );

    if (shouldHoldAssemblyReveal) {
      setIsHoldingStageCompletion(true);
      revealTimeoutRef.current = window.setTimeout(() => {
        revealedBookIdRef.current = nextBookId;
        setIsHoldingStageCompletion(false);
        revealTimeoutRef.current = null;
      }, FINAL_ASSEMBLY_STAGE_HOLD_MS);
    } else {
      revealedBookIdRef.current = nextBookId;
      setIsHoldingStageCompletion(false);
    }

    previousStatusRef.current = currentStatus;
  }, [engine.state.status, engine.webBook?.id]);

  useEffect(() => () => {
    if (revealTimeoutRef.current !== null) {
      window.clearTimeout(revealTimeoutRef.current);
    }
  }, []);

  useEffect(() => {
    const isRunning = engine.state.status === 'searching' || 
                      engine.state.status === 'evolving' || 
                      engine.state.status === 'assembling';
    
    if (!isRunning) return;

    const interval = setInterval(() => {
      setTick((t) => t + 1);
    }, 1000);

    return () => clearInterval(interval);
  }, [engine.state.status]);

  const activeWebBook = (
    engine.webBook
    && (!isHoldingStageCompletion || revealedBookIdRef.current === engine.webBook.id)
  )
    ? engine.webBook
    : null;
  const isRunning = engine.state.status === 'searching' || 
                    engine.state.status === 'evolving' || 
                    engine.state.status === 'assembling';
  const runtimeMs = engine.artifacts.startedAt 
    ? (isRunning ? Date.now() : (engine.artifacts.updatedAt ?? Date.now())) - engine.artifacts.startedAt 
    : null;
  const completedProviders = engine.artifacts.providerStatuses.filter((status) => status.status === 'complete' || status.status === 'error').length;
  const totalProviders = engine.artifacts.providerStatuses.length;
  const frontierCount = engine.artifacts.searchResults.length;
  const evolvedCount = engine.artifacts.evolvedPopulation.length || engine.state.population.length;
  const elapsed = formatElapsed(runtimeMs);
  const searchStage: LoadingStageState = engine.artifacts.status === 'error' && frontierCount === 0
    ? 'error'
    : engine.state.status === 'searching'
      ? 'active'
      : (frontierCount > 0 || engine.state.status === 'evolving' || engine.state.status === 'assembling' || engine.state.status === 'complete')
        ? 'complete'
        : 'idle';
  const evolutionStage: LoadingStageState = engine.artifacts.status === 'error' && frontierCount > 0 && evolvedCount === 0
    ? 'error'
    : engine.state.status === 'evolving'
      ? 'active'
      : (evolvedCount > 0 || engine.state.status === 'assembling' || engine.state.status === 'complete')
        ? 'complete'
        : engine.state.status === 'searching'
          ? 'queued'
          : 'idle';
  const assemblyStage: LoadingStageState = engine.artifacts.status === 'error' && evolvedCount > 0 && !engine.webBook
    ? 'error'
    : engine.state.status === 'assembling'
      ? 'active'
      : (engine.webBook || engine.state.status === 'complete')
        ? 'complete'
        : (engine.state.status === 'searching' || engine.state.status === 'evolving')
          ? 'queued'
          : 'idle';
  const summaryMetrics = [
    {
      label: 'Sources Resolved',
      value: totalProviders ? `${completedProviders}/${totalProviders}` : '0',
      tone: 'text-blue-600',
      orbitColor: '#4f86f7',
      orbitDuration: '4s',
    },
    {
      label: 'Frontier',
      value: frontierCount,
      tone: 'text-[#141414]',
      orbitColor: '#141414',
      orbitDuration: '4s',
    },
    {
      label: 'Evolved',
      value: evolvedCount,
      tone: 'text-purple-600',
      orbitColor: '#8b5cf6',
      orbitDuration: '4s',
    },
    {
      label: 'Elapsed',
      value: elapsed,
      tone: 'text-green-600',
      orbitColor: '#22c55e',
      orbitDuration: '4s',
    },
  ];
  const activeStageDetail = isHoldingStageCompletion
    ? 'The draft is assembled. Holding the final stage for a beat so the assembly node can fully resolve before the WebBook opens.'
    : engine.state.status === 'searching'
    ? 'The engine is gathering public-web, book, and scholarly evidence before it ranks the frontier.'
    : engine.state.status === 'evolving'
      ? 'The local GA is scoring candidate sources, penalizing redundancy, and selecting the strongest evidence mix.'
      : 'The engine is clustering themes, shaping chapter arcs, and running sentence-level selection for the book draft.';
  const stageMetrics = [
    {
      label: 'Source Discovery',
      state: searchStage,
      activeText: 'text-[#141414]',
      activeDot: 'border-[#141414] bg-[#141414]',
    },
    {
      label: 'Evolutionary Selection',
      state: evolutionStage,
      activeText: 'text-purple-600',
      activeDot: 'border-purple-500 bg-purple-100',
    },
    {
      label: 'NLP Book Assembly',
      state: assemblyStage,
      activeText: 'text-green-600',
      activeDot: 'border-green-500 bg-green-100',
    },
  ];

  const handleExportPdf = async () => {
    if (!activeWebBook) return;
    setIsExporting(true);
    try {
      await exportWebBookToPdf(activeWebBook);
    } finally {
      setIsExporting(false);
    }
  };

  const handleExportPrint = async () => {
    if (!activeWebBook) return;
    setIsExporting(true);
    try {
      await printWebBook(activeWebBook);
    } finally {
      setIsExporting(false);
    }
  };

  const handleExportWord = async () => {
    if (!activeWebBook) return;
    setIsExporting(true);
    try {
      await exportWebBookToWord(activeWebBook);
    } finally {
      setIsExporting(false);
    }
  };

  const handleExportHtml = async () => {
    if (!activeWebBook) return;
    setIsExporting(true);
    try {
      await exportWebBookToHtml(activeWebBook);
    } finally {
      setIsExporting(false);
    }
  };

  const handleExportTxt = async () => {
    if (!activeWebBook) return;
    setIsExporting(true);
    try {
      await exportWebBookToTxt(activeWebBook);
    } finally {
      setIsExporting(false);
    }
  };

  const stageColorMap: Record<string, { active: string; complete: string }> = {
    'Source Discovery': {
      active: '#141414',
      complete: '#141414',
    },
    'Evolutionary Selection': {
      active: '#8b5cf6',
      complete: '#8b5cf6',
    },
    'NLP Book Assembly': {
      active: '#22c55e',
      complete: '#22c55e',
    },
  };

  return (
    <div className="min-h-screen bg-[#E4E3E0] text-[#141414] font-sans selection:bg-[#141414] selection:text-[#E4E3E0]">
      <AppHeader
        webBook={activeWebBook}
        isExporting={isExporting}
        onNewSearch={engine.startNewSearch}
        onToggleHistory={() => setShowHistory(!showHistory)}
        onExportPdf={handleExportPdf}
        onExportPrint={handleExportPrint}
        onExportWord={handleExportWord}
        onExportHtml={handleExportHtml}
        onExportTxt={handleExportTxt}
      />

      <HistoryDrawer
        showHistory={showHistory}
        history={engine.history}
        onClose={() => setShowHistory(false)}
        onView={(item) => {
          engine.viewHistoryItem(item);
          setShowHistory(false);
        }}
        onDelete={engine.deleteHistoryItem}
        onClearAll={engine.clearAllHistory}
      />

      <main className="max-w-[1440px] mx-auto p-4 md:p-8 grid grid-cols-1 lg:grid-cols-12 gap-8 items-start my-8">
        <ControlSidebar
          query={engine.query}
          onQueryChange={engine.setQuery}
          state={engine.state}
          error={engine.error}
          notice={engine.notice}
          artifacts={engine.artifacts} runtimeMs={runtimeMs}
          showArtifacts={showArtifacts}
          onToggleArtifacts={() => setShowArtifacts(!showArtifacts)}
          onSearch={engine.runSearch}
          onStartNewSearch={engine.startNewSearch}
          sourceConfig={engine.sourceConfig}
          manualSourceInput={engine.manualSourceInput}
          setManualSourceInput={engine.setManualSourceInput}
          toggleBuiltInSource={engine.toggleBuiltInSource}
          setAllBuiltInSources={engine.setAllBuiltInSources}
          setExecutionMode={engine.setExecutionMode}
          addManualSources={engine.addManualSources}
          removeManualSource={engine.removeManualSource}
        />

        <div className="lg:col-span-8 space-y-8 flex flex-col min-h-[60vh] relative w-full overflow-hidden print:overflow-visible">
          <AnimatePresence mode="popLayout">
            {activeWebBook ? (
              <motion.div
                key="web-book"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="w-full flex justify-center"
              >
                <WebBookViewer
                  webBook={activeWebBook}
                  rewardProfile={engine.rewardProfile}
                  onUpdateWebBookFeedback={engine.updateWebBookFeedback}
                  onUpdateChapterFeedback={engine.updateChapterFeedback}
                />
              </motion.div>
            ) : engine.state.status === 'idle' ? (
              <motion.div
                key="empty-state"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="text-center opacity-50 select-none print:hidden flex flex-col items-center justify-center flex-1 max-w-xl mx-auto min-h-[400px]"
              >
                <div className="text-2xl font-serif italic mb-8">Awaiting Input...</div>
                <div className="text-xs uppercase font-mono tracking-[0.25em] leading-loose">
                  Provide a topic to initiate the evolutionary synthesis process. The engine will forage for sources, compute fitness scores, and construct a comprehensive multi-page output.
                </div>
              </motion.div>
            ) : (
              <motion.div
                key="loading-state"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="print:hidden flex flex-col items-center justify-center flex-1 w-full bg-white border border-[#141414] shadow-[12px_12px_0px_0px_rgba(20,20,20,0.12)] p-12 min-h-[600px] mb-8"
              >
                <div className="flex flex-col items-center justify-center max-w-2xl mx-auto w-full text-center">
                  <div className="relative w-24 h-24 mb-10 mx-auto">
                    <div className="absolute inset-0 border-2 border-[#141414] rounded-full border-t-transparent animate-spin opacity-60" style={{ animationDuration: '2s' }} />
                    <div className="absolute inset-2 border-2 border-[#141414] rounded-full border-b-transparent animate-spin" style={{ animationDirection: 'reverse', animationDuration: '3s', opacity: 0.8 }} />
                    <div className="absolute inset-0 flex items-center justify-center text-[#141414]">
                      <InfinityIcon size={28} strokeWidth={1.5} className="opacity-40 animate-pulse" />
                    </div>
                  </div>

                  <h2 className="text-2xl md:text-3xl font-serif italic text-[#141414] mb-6 tracking-widest break-words w-full">
                    EVOLVING KNOWLEDGE STRUCTURE
                  </h2>
                  <p className="text-xs uppercase font-mono tracking-widest leading-loose text-[#141414]/50 mb-12 max-w-lg mx-auto">
                    {activeStageDetail}
                  </p>

                  <div className="w-full max-w-xl mx-auto border-t border-b border-[#141414]/10 py-12 relative overflow-hidden">
                    {/* Stage progression visualization */}
                    <div className="relative flex flex-col items-center justify-center px-2 md:px-8">
                      <div className="grid w-full grid-cols-3">
                        {stageMetrics.map((stage) => {
                          const stageColor = stageColorMap[stage.label];

                          return (
                            <div key={`${stage.label}-label`} className="mb-4 text-center">
                              <span
                                className="text-[9px] font-bold uppercase tracking-widest transition-colors duration-500"
                                style={{ color: stageColor.complete }}
                              >
                                {stage.label}
                              </span>
                            </div>
                          );
                        })}
                      </div>

                      <div className="relative grid w-full grid-cols-3 items-center">
                        {stageMetrics.map((stage, index) => {
                          const stageColor = stageColorMap[stage.label];
                          const dotColor = stageColor.complete;
                          const isActive = stage.state === 'active';
                          const isComplete = stage.state === 'complete';
                          const isQueued = stage.state === 'queued';
                          const isIdle = stage.state === 'idle';
                          const showsOpaqueShell = isComplete;
                          const showConnector = index < stageMetrics.length - 1;
                          const isConnectorVisible = isActive || isComplete;

                          return (
                            <div key={stage.label} className="relative flex h-8 items-center justify-center">
                              {showConnector && (
                                <div className="pointer-events-none absolute left-1/2 top-1/2 z-0 h-[3px] w-full -translate-y-1/2">
                                  <div
                                    className="h-full rounded-full transition-all duration-500"
                                    style={{
                                      backgroundColor: isConnectorVisible ? dotColor : '#d8dce2',
                                      opacity: isConnectorVisible ? 0.95 : 0.45,
                                      transitionDelay: isConnectorVisible ? `${index * 140}ms` : '0ms',
                                    }}
                                  />
                                </div>
                              )}

                              <div className="relative z-10 flex h-8 w-8 flex-shrink-0 items-center justify-center">
                                <div
                                  className="absolute inset-0 rounded-full border transition-all duration-500"
                                  style={{
                                    backgroundColor: showsOpaqueShell ? dotColor : '#ffffff',
                                    borderColor: showsOpaqueShell
                                      ? dotColor
                                      : isActive
                                        ? `${dotColor}33`
                                        : '#d1d5db',
                                    opacity: showsOpaqueShell ? 1 : isIdle ? 0.72 : 0.92,
                                  }}
                                />

                                {isActive && (
                                  <div
                                    className="absolute inset-0 rounded-full border-[2.5px]"
                                    style={{
                                      borderColor: dotColor,
                                      borderTopColor: 'transparent',
                                      animation: 'spin 0.6s linear infinite',
                                    }}
                                  />
                                )}

                                <div
                                  className={`relative z-10 rounded-full transition-all duration-500 ${
                                    showsOpaqueShell
                                      ? 'h-6 w-6 shadow-md'
                                      : isActive
                                        ? 'h-4 w-4 shadow-lg animate-pulse'
                                        : 'h-4 w-4 shadow-sm'
                                  }`}
                                  style={{
                                    backgroundColor: dotColor,
                                    opacity: isIdle ? 0.35 : isQueued ? 0.6 : 1,
                                  }}
                                />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>

                  <div className="mt-16 pt-8 w-full border-t border-[#141414]/5 grid grid-cols-2 md:grid-cols-4 gap-4 justify-items-center opacity-80 bg-[#FAFAFA] p-6 rounded shadow-inner">
                    {summaryMetrics.map((metric) => (
                      <div key={metric.label} className="flex flex-col items-center overflow-hidden w-full">
                        <span className={`text-[9px] font-bold uppercase tracking-widest mb-2 truncate ${metric.tone}`}>{metric.label}</span>
                        <div className="relative h-16 w-16 flex items-center justify-center">
                          <svg className="absolute inset-0 h-full w-full" viewBox="0 0 100 100" aria-hidden="true">
                            <circle cx="50" cy="50" r="46" stroke="#141414" strokeWidth="1.5" fill="none" opacity="0.08" />
                            <circle
                              cx="50"
                              cy="50"
                              r="46"
                              stroke={metric.orbitColor}
                              strokeWidth="2"
                              strokeDasharray="4 6"
                              fill="none"
                              opacity="1.5"
                              style={{
                                animation: `spin ${metric.orbitDuration} linear infinite`
                              }}
                            />
                          </svg>
                          <span className="relative text-2xl font-mono text-[#141414]">{metric.value}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </main>
    </div>
  );
}
