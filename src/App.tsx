/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { useWebBookEngine } from './hooks/useWebBookEngine';
import { ControlSidebar } from './components/ControlSidebar';
import { AppHeader } from './components/AppHeader';
import { HistoryDrawer } from './components/HistoryDrawer';
import { WebBookViewer } from './components/WebBookViewer';
import { exportWebBookToPdf, printWebBook, exportWebBookToWord, exportWebBookToHtml, exportWebBookToTxt } from './services/exportService';
import { motion, AnimatePresence } from 'motion/react';
import { Infinity as InfinityIcon } from 'lucide-react';

export default function App() {
  const [showHistory, setShowHistory] = useState(false);
  const [showArtifacts, setShowArtifacts] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  const engine = useWebBookEngine();

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
                  <p className="text-xs uppercase font-mono tracking-widest leading-loose text-[#141414]/50 mb-20 max-w-lg mx-auto">
                    The engine is currently mining concepts, evaluating informative value, and pruning redundant data structures...
                  </p>

                  <div className="w-full max-w-xl mx-auto border-t border-b border-[#141414]/10 py-12 relative overflow-hidden">
                    <div className="absolute top-1/2 left-0 right-0 h-[1px] bg-[#141414]/20 -translate-y-1/2 z-0" />
                    <div className="relative z-10 flex justify-between items-center px-2 md:px-8">
                      <div className="flex flex-col items-center gap-5 bg-white px-4">
                        <div className={`w-3.5 h-3.5 rounded-full border-2 ${
                          engine.state.status === 'searching' ? 'border-blue-500 bg-blue-100 animate-pulse scale-150' : 'border-[#141414] bg-[#141414]'
                        }`} style={{ transition: 'all 0.5s ease' }} />
                        <span className={`text-[10px] font-bold tracking-[0.2em] uppercase ${
                          engine.state.status === 'searching' ? 'text-blue-600' : 'text-[#141414]'
                        }`}>Crawling</span>
                      </div>
                      <div className="flex flex-col items-center gap-5 bg-white px-4">
                        <div className={`w-3.5 h-3.5 rounded-full border-2 ${
                          (engine.state.status === 'assembling' || engine.state.status === 'complete') ? 'border-[#141414] bg-[#141414]' :
                          engine.state.status === 'evolving' ? 'border-purple-500 bg-purple-100 animate-pulse scale-150' : 'border-[#141414]/30 bg-white'
                        }`} style={{ transition: 'all 0.5s ease' }} />
                        <span className={`text-[10px] font-bold tracking-[0.2em] uppercase ${
                          (engine.state.status === 'assembling' || engine.state.status === 'complete') ? 'text-[#141414]' :
                          engine.state.status === 'evolving' ? 'text-purple-600' : 'text-[#141414]/40'
                        }`}>Evolving</span>
                      </div>
                      <div className="flex flex-col items-center gap-5 bg-white px-4">
                        <div className={`w-3.5 h-3.5 rounded-full border-2 ${
                          engine.state.status === 'assembling' ? 'border-green-500 bg-green-100 animate-pulse scale-150' : 'border-[#141414]/30 bg-white'
                        }`} style={{ transition: 'all 0.5s ease' }} />
                        <span className={`text-[10px] font-bold tracking-[0.2em] uppercase ${
                          engine.state.status === 'assembling' ? 'text-green-600' : 'text-[#141414]/40'
                        }`}>Assembling</span>
                      </div>
                    </div>
                  </div>

                  <div className="mt-16 pt-8 w-full border-t border-[#141414]/5 grid grid-cols-3 gap-4 justify-items-center opacity-80 bg-[#FAFAFA] p-6 rounded shadow-inner">
                    <div className="flex flex-col items-center overflow-hidden w-full">
                      <span className="text-[9px] font-bold text-blue-600 uppercase tracking-widest mb-2 truncate">Generation</span>
                      <span className="text-2xl font-mono text-[#141414]">{engine.state.generation}</span>
                    </div>
                    <div className="flex flex-col items-center overflow-hidden w-full border-l border-r border-[#141414]/10">
                      <span className="text-[9px] font-bold text-purple-600 uppercase tracking-widest mb-2 truncate">Pop. Size</span>
                      <span className="text-2xl font-mono text-[#141414]">{engine.state.population?.length || 0}</span>
                    </div>
                    <div className="flex flex-col items-center overflow-hidden w-full">
                      <span className="text-[9px] font-bold text-green-600 uppercase tracking-widest mb-2 truncate">Fitness (Fw)</span>
                      <span className="text-2xl font-mono text-[#141414]">{(engine.state.bestFitness || 0).toFixed(4)}</span>
                    </div>
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
