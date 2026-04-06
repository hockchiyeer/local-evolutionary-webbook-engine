/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export type SearchSourceKey = "wikipedia" | "openlibrary" | "crossref" | "duckduckgo" | "google" | "bing";
export type SearchExecutionMode = "sequential" | "parallel";
export type FeedbackSignal = "positive" | "negative";
export type FeedbackIssueTag =
  | "too_generic"
  | "repetitive"
  | "weak_evidence"
  | "unclear_titles"
  | "wrong_structure"
  | "clear_structure"
  | "strong_evidence"
  | "insightful_synthesis";

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
  id?: string;
  title: string;
  content: string;
  sources: SourceReference[];
  sourceUrls: SourceReference[];
  visualSeed?: string;
  definitions: Definition[];
  subTopics: SubTopic[];
  facetLabel?: string;
  archetype?: string;
}

export interface ChapterFeedback {
  signal: FeedbackSignal | null;
  issueTags: FeedbackIssueTag[];
  updatedAt: number | null;
}

export interface WebBookFeedback {
  bookSignal: FeedbackSignal | null;
  issueTags: FeedbackIssueTag[];
  chapterFeedback: Record<string, ChapterFeedback>;
  updatedAt: number | null;
}

export interface RewardWeightProfile {
  relevance: number;
  coverage: number;
  authority: number;
  evidenceDensity: number;
  diversity: number;
  structure: number;
  coherence: number;
  titleSpecificity: number;
  antiRedundancy: number;
}

export interface RewardProfile {
  sampleSize: number;
  positiveSignals: number;
  negativeSignals: number;
  dominantIssues: FeedbackIssueTag[];
  weights: RewardWeightProfile;
  updatedAt: number | null;
}

export interface ProviderRunSummary {
  provider: string;
  status: "queued" | "running" | "complete" | "error";
  resultCount: number;
  frontierCount: number;
  durationMs: number | null;
  error: string | null;
}

export interface WebBookRunContext {
  sourceConfig: SearchSourceConfig;
  bestFitness: number;
  providerStatuses: ProviderRunSummary[];
  rewardProfileSnapshot: RewardProfile;
}

export interface WebBook {
  id: string;
  topic: string;
  chapters: Chapter[];
  timestamp: number;
  topicArea?: string;
  feedback?: WebBookFeedback;
  runContext?: WebBookRunContext;
}

export type EvolutionStatus = 'idle' | 'searching' | 'evolving' | 'assembling' | 'complete';

export interface EvolutionState {
  generation: number;
  population: WebPageGenotype[];
  bestFitness: number;
  status: EvolutionStatus;
}
