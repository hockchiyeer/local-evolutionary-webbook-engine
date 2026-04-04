/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export type SearchSourceKey = "wikipedia" | "duckduckgo" | "google" | "bing";
export type SearchExecutionMode = "sequential" | "parallel";

export interface SearchSourceConfig {
  sources: Record<SearchSourceKey, boolean>;
  manualUrls: string[];
  executionMode: SearchExecutionMode;
}

export interface SourceReference {
  title?: string;
  url: string;
}

export interface Definition {
  term: string;
  description: string;
  sourceUrl: string;
}

export interface SubTopic {
  title: string;
  summary: string;
  sourceUrl: string;
}

export interface WebPageGenotype {
  id: string;
  url: string;
  title: string;
  content: string;
  definitions: Definition[];
  subTopics: SubTopic[];
  informativeScore: number;
  authorityScore: number;
  fitness: number;
  searchProvider: string;
  searchProviders: string[];
}

export interface Chapter {
  id: string;
  title: string;
  content: string;
  sources: SourceReference[];
  sourceUrls: SourceReference[];
  visualSeed?: string;
  definitions: Definition[];
  subTopics: SubTopic[];
}

export interface WebBook {
  id: string;
  topic: string;
  chapters: Chapter[];
  timestamp: number;
}

export type EvolutionStatus = 'idle' | 'searching' | 'evolving' | 'assembling' | 'complete';

export interface EvolutionState {
  generation: number;
  population: WebPageGenotype[];
  bestFitness: number;
  status: EvolutionStatus;
}
