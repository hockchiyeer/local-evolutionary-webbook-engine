/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState } from 'react';
import { useWebBookEngine } from './hooks/useWebBookEngine';
import { ControlSidebar } from './components/ControlSidebar';
import { AppHeader } from './components/AppHeader';
import { HistoryDrawer } from './components/HistoryDrawer';
import { WebBookViewer } from './components/WebBookViewer';
import { exportWebBookToPdf, printWebBook, exportWebBookToWord, exportWebBookToHtml, exportWebBookToTxt } from './services/exportService';
import { motion, AnimatePresence } from 'motion/react';
import { Cpu, Dna, Search } from 'lucide-react';

export default function App() {
  const [showHistory, setShowHistory] = useState(false);
  const [showArtifacts, setShowArtifacts] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  const engine = useWebBookEngine();
  const runtimeMs = engine.artifacts.startedAt ? (engine.artifacts.updatedAt ?? Date.now()) - engine.artifacts.startedAt : null;
  const completedProviders = engine.artifacts.providerStatuses.filter((status) => status.status === 'complete' || status.status === 'error').length;
  const totalProviders = engine.artifacts.providerStatuses.length;
  const frontierCount = engine.artifacts.searchResults.length;
  const evolvedCount = engine.artifacts.evolvedPopulation.length;
  const showRightPaneIntro = !engine.webBook && engine.state.status === 'idle';
  const activeStage = engine.state.status === 'searching'
    ? {
        eyebrow: 'Source Discovery',
        detail: 'The engine is gathering public-web, book, and scholarly evidence before it ranks the frontier.',
      }
    : engine.state.status === 'evolving'
      ? {
          eyebrow: 'Evolutionary Selection',
          detail: 'The local GA is scoring candidate sources, penalizing redundancy, and selecting the strongest evidence mix.',
        }
      : {
          eyebrow: 'NLP Book Assembly',
          detail: 'The engine is clustering themes, shaping chapter arcs, and running sentence-level selection for the book draft.',
        };

  const handleExportPdf = async () => {
    if (!engine.webBook) return;
    setIsExporting(true);
    try {
      await exportWebBookToPdf(engine.webBook);
    } finally {
      setIsExporting(false);
    }
  };

  const handleExportPrint = async () => {
    if (!engine.webBook) return;
    setIsExporting(true);
    try {
      await printWebBook(engine.webBook);
    } finally {
      setIsExporting(false);
    }
  };

  const handleExportWord = async () => {
    if (!engine.webBook) return;
    setIsExporting(true);
    try {
      await exportWebBookToWord(engine.webBook);
    } finally {
      setIsExporting(false);
    }
  };

  const handleExportHtml = async () => {
    if (!engine.webBook) return;
    setIsExporting(true);
    try {
      await exportWebBookToHtml(engine.webBook);
    } finally {
      setIsExporting(false);
    }
  };

  const handleExportTxt = async () => {
    if (!engine.webBook) return;
    setIsExporting(true);
    try {
      await exportWebBookToTxt(engine.webBook);
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#E4E3E0] text-[#141414] font-sans selection:bg-[#141414] selection:text-[#E4E3E0]">
      <AppHeader
        webBook={engine.webBook}
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
          artifacts={engine.artifacts}
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
          {showRightPaneIntro && (
            <motion.section
              key="right-pane-intro"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              className="print:hidden rounded-[30px] border border-[#1d1710] bg-[linear-gradient(180deg,#fffef8_0%,#f2e6d5_100%)] p-6 shadow-[0_24px_60px_-36px_rgba(34,24,12,0.45)] md:p-8"
            >
              <p className="text-[11px] font-semibold uppercase tracking-[0.34em] text-[#7b6e5d]">WebBook Studio</p>
              <div className="mt-4 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                <div className="min-w-0">
                  <h2 className="font-serif text-[2.2rem] leading-none text-[#1d1710] md:text-[3rem]">
                    Tune the next reading run
                  </h2>
                  <p className="mt-4 max-w-2xl text-sm leading-7 text-[#5d5245] md:text-base">
                    Blend public sources, domain-specific metadata, and local evolutionary synthesis into a stronger reading report.
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-3 text-left sm:grid-cols-3">
                  <div className="rounded-[18px] border border-[#d8ccbd] bg-[#fffdf8] px-4 py-3">
                    <div className="text-[10px] uppercase tracking-[0.22em] text-[#8a7b67]">Sources</div>
                    <div className="mt-2 text-lg font-semibold text-[#1d1710]">{Object.values(engine.sourceConfig.sources).filter(Boolean).length + engine.sourceConfig.manualUrls.length}</div>
                  </div>
                  <div className="rounded-[18px] border border-[#d8ccbd] bg-[#fffdf8] px-4 py-3">
                    <div className="text-[10px] uppercase tracking-[0.22em] text-[#8a7b67]">Mode</div>
                    <div className="mt-2 text-lg font-semibold leading-tight text-[#1d1710]">{engine.sourceConfig.executionMode === 'parallel' ? 'Parallel' : 'Sequential'}</div>
                  </div>
                  <div className="col-span-2 rounded-[18px] border border-[#d8ccbd] bg-[#fffdf8] px-4 py-3 sm:col-span-1">
                    <div className="text-[10px] uppercase tracking-[0.22em] text-[#8a7b67]">Pipeline</div>
                    <div className="mt-2 text-lg font-semibold leading-tight text-[#1d1710]">Ready to launch</div>
                  </div>
                </div>
              </div>
            </motion.section>
          )}

          <AnimatePresence mode="popLayout">
            {engine.webBook ? (
              <motion.div
                key="web-book"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="w-full flex justify-center"
              >
                <WebBookViewer webBook={engine.webBook} />
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
                className="print:hidden flex flex-col justify-center flex-1 w-full rounded-[34px] border border-[#1d1710] bg-[linear-gradient(180deg,#fffef8_0%,#efe4d2_100%)] p-8 md:p-12 min-h-[620px] mb-8 shadow-[0_28px_80px_-44px_rgba(34,24,12,0.5)]"
              >
                <div className="mx-auto flex w-full max-w-3xl flex-col justify-center text-center">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.34em] text-[#7b6e5d]">
                    {activeStage.eyebrow}
                  </div>
                  <h2 className="mt-4 font-serif text-[2.6rem] leading-none text-[#1d1710]">
                    Building the next WebBook
                  </h2>
                  <p className="mx-auto mt-4 max-w-2xl text-sm leading-7 text-[#5d5245]">
                    {activeStage.detail}
                  </p>

                  <div className="mt-8 grid grid-cols-2 gap-3 md:grid-cols-4">
                    <div className="rounded-[22px] border border-[#d8ccbd] bg-[#fffdf8] p-4 text-left">
                      <div className="text-[10px] uppercase tracking-[0.24em] text-[#8a7b67]">Sources Resolved</div>
                      <div className="mt-2 text-2xl font-semibold text-[#1d1710]">{totalProviders ? `${completedProviders}/${totalProviders}` : '0'}</div>
                    </div>
                    <div className="rounded-[22px] border border-[#d8ccbd] bg-[#fffdf8] p-4 text-left">
                      <div className="text-[10px] uppercase tracking-[0.24em] text-[#8a7b67]">Frontier</div>
                      <div className="mt-2 text-2xl font-semibold text-[#1d1710]">{frontierCount}</div>
                    </div>
                    <div className="rounded-[22px] border border-[#d8ccbd] bg-[#fffdf8] p-4 text-left">
                      <div className="text-[10px] uppercase tracking-[0.24em] text-[#8a7b67]">Evolved</div>
                      <div className="mt-2 text-2xl font-semibold text-[#1d1710]">{evolvedCount || engine.state.population.length}</div>
                    </div>
                    <div className="rounded-[22px] border border-[#d8ccbd] bg-[#fffdf8] p-4 text-left">
                      <div className="text-[10px] uppercase tracking-[0.24em] text-[#8a7b67]">Elapsed</div>
                      <div className="mt-2 text-2xl font-semibold text-[#1d1710]">{runtimeMs ? `${Math.max(1, Math.round(runtimeMs / 1000))}s` : '0s'}</div>
                    </div>
                  </div>

                  <div className="mt-8 grid gap-3 md:grid-cols-3">
                    {[
                      {
                        label: 'Source Discovery',
                        active: engine.state.status === 'searching',
                        complete: engine.state.status !== 'idle' && engine.state.status !== 'searching',
                        icon: Search,
                      },
                      {
                        label: 'Evolutionary Selection',
                        active: engine.state.status === 'evolving',
                        complete: engine.state.status === 'assembling' || engine.state.status === 'complete',
                        icon: Dna,
                      },
                      {
                        label: 'NLP Book Assembly',
                        active: engine.state.status === 'assembling',
                        complete: engine.state.status === 'complete',
                        icon: Cpu,
                      },
                    ].map((stage) => {
                      const Icon = stage.icon;
                      return (
                        <div
                          key={stage.label}
                          className={`rounded-[22px] border p-4 text-left ${
                            stage.active
                              ? 'border-[#1d1710] bg-[#1d1710] text-[#fffaf2]'
                              : stage.complete
                                ? 'border-[#245c39] bg-[#eef8f0] text-[#1f4f31]'
                                : 'border-[#d8ccbd] bg-[#fffdf8] text-[#6b5b4a]'
                          }`}
                        >
                          <div className="inline-flex items-center gap-2 text-[10px] uppercase tracking-[0.22em]">
                            <Icon size={12} />
                            {stage.label}
                          </div>
                        </div>
                      );
                    })}
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
