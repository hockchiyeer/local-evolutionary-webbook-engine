import fs from "fs";
import path from "path";
import { DatabaseSync } from "node:sqlite";
import type {
  ChapterFeedback,
  FeedbackIssueTag,
  FeedbackSignal,
  RewardProfile,
  RewardWeightProfile,
  WebBookFeedback,
} from "./src/types";

type PersistedFeedbackChapter = {
  id: string;
  title: string;
};

type PersistedFeedbackRecord = {
  id: string;
  topic: string;
  topicArea?: string;
  timestamp: number;
  chapters: PersistedFeedbackChapter[];
  feedback: WebBookFeedback;
  updatedAt: number;
};

type PersistedFeedbackEvent = {
  id: string;
  recordId: string;
  topic: string;
  topicArea?: string;
  bookTimestamp: number;
  chapters: PersistedFeedbackChapter[];
  feedback: WebBookFeedback;
  capturedAt: number;
  source: "upsert" | "bootstrap" | "migration";
};

type LegacyLearningStore = {
  version: number;
  records: Record<string, PersistedFeedbackRecord>;
  feedbackEvents: PersistedFeedbackEvent[];
  rewardProfile: RewardProfile;
  updatedAt: number | null;
};

type FeedbackRecordRow = {
  id: string;
  topic: string;
  topic_area: string | null;
  book_timestamp: number;
  chapters_json: string;
  feedback_json: string;
  updated_at: number;
};

type FeedbackEventRow = {
  id: string;
  record_id: string;
  topic: string;
  topic_area: string | null;
  book_timestamp: number;
  chapters_json: string;
  feedback_json: string;
  captured_at: number;
  source: string;
};

type RewardProfileCacheRow = {
  profile_json: string;
  updated_at: number | null;
};

type MetaRow = {
  value: string;
};

export type FeedbackLearningSummary = {
  rewardProfile: RewardProfile;
  recordCount: number;
  feedbackEventCount: number;
  updatedAt: number | null;
  backend: "sqlite";
  databasePath: string;
};

const CURRENT_LEARNING_STORE_VERSION = 3;
const DATA_DIR = path.join(process.cwd(), "data");
const SQLITE_STORE_PATH = path.join(DATA_DIR, "feedback-learning.sqlite");
const SQLITE_STORE_BACKUP_PATH = path.join(DATA_DIR, "feedback-learning.sqlite.bak");
const LEGACY_JSON_STORE_PATH = path.join(DATA_DIR, "feedback-learning.json");
const LEGACY_BACKUP_DIR = path.join(DATA_DIR, "backups");

const DEFAULT_REWARD_WEIGHTS: RewardWeightProfile = {
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
  too_generic: { relevance: 0.08, coverage: 0.04, titleSpecificity: 0.1 },
  repetitive: { diversity: 0.12, antiRedundancy: 0.12, coherence: 0.03 },
  weak_evidence: { authority: 0.1, evidenceDensity: 0.12, structure: 0.04 },
  unclear_titles: { titleSpecificity: 0.14, relevance: 0.05 },
  wrong_structure: { structure: 0.12, coherence: 0.08 },
  clear_structure: { structure: 0.05, coherence: 0.05 },
  strong_evidence: { authority: 0.05, evidenceDensity: 0.06 },
  insightful_synthesis: { coherence: 0.08, diversity: 0.04, relevance: 0.03 },
};

const clampRewardWeight = (value: number) => Number(Math.min(1.35, Math.max(0.82, value)).toFixed(3));
const normalizeCustomTagValue = (value: string) => value.trim().replace(/\s+/g, " ").slice(0, 48);
const customTagKey = (value: string) => normalizeCustomTagValue(value).toLowerCase();

const createEmptyRewardProfile = (): RewardProfile => ({
  sampleSize: 0,
  positiveSignals: 0,
  negativeSignals: 0,
  dominantIssues: [],
  dominantCustomTags: [],
  weights: { ...DEFAULT_REWARD_WEIGHTS },
  updatedAt: null,
});

const normalizeFeedbackSignal = (value: unknown): FeedbackSignal | null => (
  value === "positive" || value === "negative" ? value : null
);

const normalizeIssueTags = (value: unknown): FeedbackIssueTag[] => {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value.filter(
        (entry): entry is FeedbackIssueTag => typeof entry === "string" && FEEDBACK_TAG_SET.has(entry as FeedbackIssueTag),
      ),
    ),
  );
};

const normalizeCustomTags = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }

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

const normalizeChapterFeedback = (value: unknown): ChapterFeedback => {
  if (!value || typeof value !== "object") {
    return {
      signal: null,
      issueTags: [],
      customTags: [],
      updatedAt: null,
    };
  }

  const candidate = value as Partial<ChapterFeedback>;
  return {
    signal: normalizeFeedbackSignal(candidate.signal),
    issueTags: normalizeIssueTags(candidate.issueTags),
    customTags: normalizeCustomTags(candidate.customTags),
    updatedAt: typeof candidate.updatedAt === "number" ? candidate.updatedAt : null,
  };
};

const normalizeRewardProfile = (value: unknown): RewardProfile => {
  if (!value || typeof value !== "object") {
    return createEmptyRewardProfile();
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

const hasPersistableFeedback = (feedback: WebBookFeedback) => (
  Boolean(feedback.bookSignal)
  || feedback.issueTags.length > 0
  || feedback.customTags.length > 0
  || Object.values(feedback.chapterFeedback).some((entry) => entry.signal || entry.issueTags.length > 0 || entry.customTags.length > 0)
);

const normalizePersistedFeedbackRecord = (value: unknown): PersistedFeedbackRecord | null => {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Record<string, unknown>;
  const id = String(candidate.id || "").trim();
  if (!id) {
    return null;
  }

  const chapters = Array.isArray(candidate.chapters)
    ? candidate.chapters.map((chapter, index) => ({
        id: String((chapter as Record<string, unknown>)?.id || `${id}-chapter-${index + 1}`),
        title: String((chapter as Record<string, unknown>)?.title || `Chapter ${index + 1}`),
      }))
    : [];
  const rawFeedback = candidate.feedback && typeof candidate.feedback === "object"
    ? candidate.feedback as Partial<WebBookFeedback> & { chapterFeedback?: Record<string, unknown> }
    : {};
  const rawChapterFeedback = rawFeedback.chapterFeedback && typeof rawFeedback.chapterFeedback === "object"
    ? rawFeedback.chapterFeedback
    : {};
  const chapterFeedback = Object.fromEntries(
    chapters.map((chapter, index) => {
      const rawMatch = rawChapterFeedback[chapter.id]
        || rawChapterFeedback[String(index)]
        || rawChapterFeedback[chapter.title];
      return [chapter.id, normalizeChapterFeedback(rawMatch)];
    }),
  );

  const feedback: WebBookFeedback = {
    bookSignal: normalizeFeedbackSignal(rawFeedback.bookSignal),
    issueTags: normalizeIssueTags(rawFeedback.issueTags),
    customTags: normalizeCustomTags(rawFeedback.customTags),
    chapterFeedback,
    updatedAt: typeof rawFeedback.updatedAt === "number" ? rawFeedback.updatedAt : Date.now(),
  };

  if (!hasPersistableFeedback(feedback)) {
    return null;
  }

  const updatedAt = Math.max(
    feedback.updatedAt || 0,
    ...Object.values(chapterFeedback).map((entry) => entry.updatedAt || 0),
  );

  return {
    id,
    topic: String(candidate.topic || ""),
    topicArea: typeof candidate.topicArea === "string" ? candidate.topicArea : undefined,
    timestamp: Number(candidate.timestamp || Date.now()),
    chapters,
    feedback,
    updatedAt,
  };
};

const normalizePersistedFeedbackEvent = (value: unknown): PersistedFeedbackEvent | null => {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Record<string, unknown>;
  const recordId = String(candidate.recordId || candidate.id || "").trim();
  if (!recordId) {
    return null;
  }

  const chapters = Array.isArray(candidate.chapters)
    ? candidate.chapters.map((chapter, index) => ({
        id: String((chapter as Record<string, unknown>)?.id || `${recordId}-chapter-${index + 1}`),
        title: String((chapter as Record<string, unknown>)?.title || `Chapter ${index + 1}`),
      }))
    : [];
  const rawFeedback = candidate.feedback && typeof candidate.feedback === "object"
    ? candidate.feedback as Partial<WebBookFeedback> & { chapterFeedback?: Record<string, unknown> }
    : {};
  const rawChapterFeedback = rawFeedback.chapterFeedback && typeof rawFeedback.chapterFeedback === "object"
    ? rawFeedback.chapterFeedback
    : {};
  const chapterFeedbackEntries = Object.fromEntries(
    Object.entries(rawChapterFeedback).map(([key, entry]) => [key, normalizeChapterFeedback(entry)]),
  );
  const feedback: WebBookFeedback = {
    bookSignal: normalizeFeedbackSignal(rawFeedback.bookSignal),
    issueTags: normalizeIssueTags(rawFeedback.issueTags),
    customTags: normalizeCustomTags(rawFeedback.customTags),
    chapterFeedback: chapterFeedbackEntries,
    updatedAt: typeof rawFeedback.updatedAt === "number" ? rawFeedback.updatedAt : null,
  };

  return {
    id: String(candidate.id || `feedback-event-${recordId}-${candidate.capturedAt || Date.now()}`),
    recordId,
    topic: String(candidate.topic || ""),
    topicArea: typeof candidate.topicArea === "string" ? candidate.topicArea : undefined,
    bookTimestamp: Number(candidate.bookTimestamp || candidate.timestamp || Date.now()),
    chapters,
    feedback,
    capturedAt: Number(candidate.capturedAt || Date.now()),
    source: candidate.source === "bootstrap" || candidate.source === "migration" ? candidate.source : "upsert",
  };
};

const buildRewardProfileFromPersistedRecords = (records: PersistedFeedbackRecord[]): RewardProfile => {
  const weights: RewardWeightProfile = { ...DEFAULT_REWARD_WEIGHTS };
  const issueCounts = new Map<FeedbackIssueTag, number>();
  const customTagCounts = new Map<string, { label: string; count: number }>();
  let sampleSize = 0;
  let positiveSignals = 0;
  let negativeSignals = 0;
  let latestUpdatedAt: number | null = null;

  records.forEach((record) => {
    const feedback = record.feedback;
    const chapterFeedbackEntries = Object.values(feedback.chapterFeedback || {});
    const feedbackSignals = [
      feedback.bookSignal,
      ...chapterFeedbackEntries.map((entry) => entry.signal),
    ].filter((signal): signal is FeedbackSignal => signal === "positive" || signal === "negative");
    const allIssueTags = [
      ...feedback.issueTags,
      ...chapterFeedbackEntries.flatMap((entry) => entry.issueTags),
    ];
    const allCustomTags = [
      ...feedback.customTags,
      ...chapterFeedbackEntries.flatMap((entry) => entry.customTags),
    ];
    const uniqueIssueTags = Array.from(new Set(allIssueTags));
    const uniqueCustomTags = normalizeCustomTags(allCustomTags);

    if (feedbackSignals.length === 0 && uniqueIssueTags.length === 0 && uniqueCustomTags.length === 0) {
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
      const key = customTagKey(tag);
      const current = customTagCounts.get(key);
      if (current) {
        current.count += 1;
      } else {
        customTagCounts.set(key, { label: tag, count: 1 });
      }
      applyRewardDelta(weights, inferCustomTagImpact(tag));
    });

    if (feedback.bookSignal === "positive") {
      weights.coherence += 0.03;
      weights.evidenceDensity += 0.02;
    }
    if (feedback.bookSignal === "negative") {
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
      record.updatedAt || 0,
      feedback.updatedAt || 0,
      ...chapterFeedbackEntries.map((entry) => entry.updatedAt || 0),
    ) || latestUpdatedAt;
  });

  return {
    sampleSize,
    positiveSignals,
    negativeSignals,
    dominantIssues: Array.from(issueCounts.entries())
      .sort((left, right) => {
        if (right[1] !== left[1]) {
          return right[1] - left[1];
        }

        const leftPositive = POSITIVE_FEEDBACK_TAGS.has(left[0]) ? 1 : 0;
        const rightPositive = POSITIVE_FEEDBACK_TAGS.has(right[0]) ? 1 : 0;
        return leftPositive - rightPositive;
      })
      .slice(0, 3)
      .map(([tag]) => tag),
    dominantCustomTags: Array.from(customTagCounts.values())
      .sort((left, right) => right.count - left.count)
      .slice(0, 4)
      .map((entry) => entry.label),
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

const buildFeedbackEventFromRecord = (
  record: PersistedFeedbackRecord,
  source: PersistedFeedbackEvent["source"] = "upsert",
): PersistedFeedbackEvent => ({
  id: `feedback-event-${record.id}-${record.updatedAt}`,
  recordId: record.id,
  topic: record.topic,
  topicArea: record.topicArea,
  bookTimestamp: record.timestamp,
  chapters: record.chapters,
  feedback: record.feedback,
  capturedAt: record.updatedAt,
  source,
});

const mergeChapters = (
  existingChapters: PersistedFeedbackChapter[],
  incomingChapters: PersistedFeedbackChapter[],
) => {
  const chapterMap = new Map<string, PersistedFeedbackChapter>();

  incomingChapters.forEach((chapter) => {
    chapterMap.set(chapter.id, chapter);
  });
  existingChapters.forEach((chapter) => {
    if (!chapterMap.has(chapter.id)) {
      chapterMap.set(chapter.id, chapter);
    }
  });

  return Array.from(chapterMap.values());
};

const mergeFeedbackRecords = (
  existingRecord: PersistedFeedbackRecord | undefined,
  incomingRecord: PersistedFeedbackRecord,
): PersistedFeedbackRecord => {
  if (!existingRecord) {
    return incomingRecord;
  }

  return {
    ...existingRecord,
    ...incomingRecord,
    chapters: mergeChapters(existingRecord.chapters, incomingRecord.chapters),
    feedback: {
      ...existingRecord.feedback,
      ...incomingRecord.feedback,
      chapterFeedback: {
        ...existingRecord.feedback.chapterFeedback,
        ...incomingRecord.feedback.chapterFeedback,
      },
      updatedAt: Math.max(existingRecord.feedback.updatedAt || 0, incomingRecord.feedback.updatedAt || 0),
    },
    updatedAt: Math.max(existingRecord.updatedAt || 0, incomingRecord.updatedAt || 0),
  };
};

const shouldAppendFeedbackEvent = (
  existingRecord: PersistedFeedbackRecord | undefined,
  mergedRecord: PersistedFeedbackRecord,
) => {
  if (!existingRecord) {
    return true;
  }

  const before = JSON.stringify(existingRecord.feedback);
  const after = JSON.stringify(mergedRecord.feedback);
  return before !== after;
};

const parseJsonValue = <T>(value: string | null | undefined, fallback: T): T => {
  if (!value || !value.trim()) {
    return fallback;
  }

  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
};

const ensureDataDirectory = () => {
  fs.mkdirSync(DATA_DIR, { recursive: true });
};

const ensureLegacyBackupDirectory = () => {
  fs.mkdirSync(LEGACY_BACKUP_DIR, { recursive: true });
};

class PersistentFeedbackStore {
  private db: DatabaseSync;

  constructor(private readonly databasePath: string) {
    ensureDataDirectory();
    this.db = new DatabaseSync(databasePath);
  }

  initialize() {
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = FULL;
      PRAGMA foreign_keys = ON;
      PRAGMA busy_timeout = 5000;
    `);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS learning_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS feedback_records (
        id TEXT PRIMARY KEY,
        topic TEXT NOT NULL,
        topic_area TEXT,
        book_timestamp INTEGER NOT NULL,
        chapters_json TEXT NOT NULL,
        feedback_json TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS feedback_events (
        id TEXT PRIMARY KEY,
        record_id TEXT NOT NULL,
        topic TEXT NOT NULL,
        topic_area TEXT,
        book_timestamp INTEGER NOT NULL,
        chapters_json TEXT NOT NULL,
        feedback_json TEXT NOT NULL,
        captured_at INTEGER NOT NULL,
        source TEXT NOT NULL,
        FOREIGN KEY(record_id) REFERENCES feedback_records(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_feedback_records_updated_at
      ON feedback_records(updated_at DESC);

      CREATE INDEX IF NOT EXISTS idx_feedback_events_record_id
      ON feedback_events(record_id);

      CREATE INDEX IF NOT EXISTS idx_feedback_events_captured_at
      ON feedback_events(captured_at DESC);

      CREATE TABLE IF NOT EXISTS reward_profile_cache (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        profile_json TEXT NOT NULL,
        updated_at INTEGER
      );
    `);

    this.setMeta("schema_version", String(CURRENT_LEARNING_STORE_VERSION));
    this.setMeta("storage_backend", "sqlite");
    this.migrateLegacyJsonStoreIfNeeded();
    this.ensureRewardProfileCache();
  }

  getSummary(): FeedbackLearningSummary {
    return {
      rewardProfile: this.getRewardProfile(),
      recordCount: this.getRecordCount(),
      feedbackEventCount: this.getFeedbackEventCount(),
      updatedAt: this.getStoreUpdatedAt(),
      backend: "sqlite",
      databasePath: this.databasePath,
    };
  }

  resolveEffectiveRewardProfile(candidate: unknown): RewardProfile {
    const normalizedCandidate = normalizeRewardProfile(candidate);
    if (normalizedCandidate.sampleSize > 0) {
      return normalizedCandidate;
    }

    return this.getRewardProfile();
  }

  upsertLearningRecords(entries: unknown[]): FeedbackLearningSummary {
    const source: PersistedFeedbackEvent["source"] = entries.length > 1 ? "bootstrap" : "upsert";
    const mutationTimestamp = Date.now();

    this.runInTransaction(() => {
      entries.forEach((entry) => {
        const normalized = normalizePersistedFeedbackRecord(entry);
        if (!normalized) {
          return;
        }

        const existingRecord = this.getRecordById(normalized.id);
        const mergedRecord = mergeFeedbackRecords(existingRecord, normalized);
        this.writeRecord(mergedRecord);

        if (shouldAppendFeedbackEvent(existingRecord, mergedRecord)) {
          this.insertFeedbackEvent(buildFeedbackEventFromRecord(mergedRecord, source));
        }
      });

      const rewardProfile = this.rebuildRewardProfileCache();
      this.setMeta("schema_version", String(CURRENT_LEARNING_STORE_VERSION));
      this.setMeta("store_updated_at", String(mutationTimestamp));
      this.setMeta("last_reward_profile_update_at", String(rewardProfile.updatedAt || mutationTimestamp));
    });

    return this.getSummary();
  }

  private runInTransaction<T>(callback: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = callback();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      try {
        this.db.exec("ROLLBACK");
      } catch {
        // Ignore rollback failures and surface the original error.
      }
      throw error;
    }
  }

  private getMeta(key: string): string | null {
    const row = this.db.prepare("SELECT value FROM learning_meta WHERE key = :key").get({ key }) as MetaRow | undefined;
    return row?.value ?? null;
  }

  private setMeta(key: string, value: string) {
    this.db.prepare(`
      INSERT INTO learning_meta (key, value)
      VALUES (:key, :value)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run({ key, value });
  }

  private getStoreUpdatedAt(): number | null {
    const raw = this.getMeta("store_updated_at");
    if (!raw) {
      return null;
    }

    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }

  private getRecordCount() {
    const row = this.db.prepare("SELECT COUNT(*) AS count FROM feedback_records").get() as { count: number };
    return Number(row?.count || 0);
  }

  private getFeedbackEventCount() {
    const row = this.db.prepare("SELECT COUNT(*) AS count FROM feedback_events").get() as { count: number };
    return Number(row?.count || 0);
  }

  private ensureRewardProfileCache() {
    const row = this.db.prepare("SELECT profile_json FROM reward_profile_cache WHERE id = 1").get() as RewardProfileCacheRow | undefined;
    if (row?.profile_json) {
      return;
    }

    this.runInTransaction(() => {
      this.rebuildRewardProfileCache();
      if (!this.getMeta("store_updated_at")) {
        this.setMeta("store_updated_at", String(Date.now()));
      }
    });
  }

  private getRewardProfile(): RewardProfile {
    const row = this.db.prepare("SELECT profile_json FROM reward_profile_cache WHERE id = 1").get() as RewardProfileCacheRow | undefined;
    if (!row?.profile_json) {
      return this.rebuildRewardProfileCache();
    }

    return normalizeRewardProfile(parseJsonValue<RewardProfile | null>(row.profile_json, null));
  }

  private rebuildRewardProfileCache(): RewardProfile {
    const rewardProfile = buildRewardProfileFromPersistedRecords(this.readAllRecords());
    const normalizedProfile = normalizeRewardProfile(rewardProfile);
    this.db.prepare(`
      INSERT INTO reward_profile_cache (id, profile_json, updated_at)
      VALUES (1, :profile_json, :updated_at)
      ON CONFLICT(id) DO UPDATE SET
        profile_json = excluded.profile_json,
        updated_at = excluded.updated_at
    `).run({
      profile_json: JSON.stringify(normalizedProfile),
      updated_at: normalizedProfile.updatedAt,
    });
    return normalizedProfile;
  }

  private writeRecord(record: PersistedFeedbackRecord) {
    this.db.prepare(`
      INSERT INTO feedback_records (
        id,
        topic,
        topic_area,
        book_timestamp,
        chapters_json,
        feedback_json,
        updated_at
      )
      VALUES (
        :id,
        :topic,
        :topic_area,
        :book_timestamp,
        :chapters_json,
        :feedback_json,
        :updated_at
      )
      ON CONFLICT(id) DO UPDATE SET
        topic = excluded.topic,
        topic_area = excluded.topic_area,
        book_timestamp = excluded.book_timestamp,
        chapters_json = excluded.chapters_json,
        feedback_json = excluded.feedback_json,
        updated_at = excluded.updated_at
    `).run({
      id: record.id,
      topic: record.topic,
      topic_area: record.topicArea ?? null,
      book_timestamp: record.timestamp,
      chapters_json: JSON.stringify(record.chapters),
      feedback_json: JSON.stringify(record.feedback),
      updated_at: record.updatedAt,
    });
  }

  private insertFeedbackEvent(event: PersistedFeedbackEvent) {
    this.db.prepare(`
      INSERT OR IGNORE INTO feedback_events (
        id,
        record_id,
        topic,
        topic_area,
        book_timestamp,
        chapters_json,
        feedback_json,
        captured_at,
        source
      )
      VALUES (
        :id,
        :record_id,
        :topic,
        :topic_area,
        :book_timestamp,
        :chapters_json,
        :feedback_json,
        :captured_at,
        :source
      )
    `).run({
      id: event.id,
      record_id: event.recordId,
      topic: event.topic,
      topic_area: event.topicArea ?? null,
      book_timestamp: event.bookTimestamp,
      chapters_json: JSON.stringify(event.chapters),
      feedback_json: JSON.stringify(event.feedback),
      captured_at: event.capturedAt,
      source: event.source,
    });
  }

  private getRecordById(id: string): PersistedFeedbackRecord | undefined {
    const row = this.db.prepare(`
      SELECT
        id,
        topic,
        topic_area,
        book_timestamp,
        chapters_json,
        feedback_json,
        updated_at
      FROM feedback_records
      WHERE id = :id
    `).get({ id }) as FeedbackRecordRow | undefined;
    return row ? this.recordRowToRecord(row) : undefined;
  }

  private readAllRecords(): PersistedFeedbackRecord[] {
    const rows = this.db.prepare(`
      SELECT
        id,
        topic,
        topic_area,
        book_timestamp,
        chapters_json,
        feedback_json,
        updated_at
      FROM feedback_records
      ORDER BY updated_at DESC
    `).all() as FeedbackRecordRow[];

    return rows
      .map((row) => this.recordRowToRecord(row))
      .filter((record): record is PersistedFeedbackRecord => Boolean(record));
  }

  private recordRowToRecord(row: FeedbackRecordRow): PersistedFeedbackRecord | null {
    return normalizePersistedFeedbackRecord({
      id: row.id,
      topic: row.topic,
      topicArea: row.topic_area ?? undefined,
      timestamp: row.book_timestamp,
      chapters: parseJsonValue<PersistedFeedbackChapter[]>(row.chapters_json, []),
      feedback: parseJsonValue<WebBookFeedback | null>(row.feedback_json, null),
    });
  }

  private eventRowToEvent(row: FeedbackEventRow): PersistedFeedbackEvent | null {
    return normalizePersistedFeedbackEvent({
      id: row.id,
      recordId: row.record_id,
      topic: row.topic,
      topicArea: row.topic_area ?? undefined,
      bookTimestamp: row.book_timestamp,
      chapters: parseJsonValue<PersistedFeedbackChapter[]>(row.chapters_json, []),
      feedback: parseJsonValue<WebBookFeedback | null>(row.feedback_json, null),
      capturedAt: row.captured_at,
      source: row.source,
    });
  }

  private readLegacyJsonStore(): LegacyLearningStore | null {
    try {
      if (!fs.existsSync(LEGACY_JSON_STORE_PATH)) {
        return null;
      }

      const raw = fs.readFileSync(LEGACY_JSON_STORE_PATH, "utf8");
      if (!raw.trim()) {
        return null;
      }

      const parsed = JSON.parse(raw) as Partial<LegacyLearningStore> & {
        records?: Record<string, unknown>;
        feedbackEvents?: unknown[];
      };
      const rawRecords = parsed.records && typeof parsed.records === "object" ? parsed.records : {};
      const records = Object.fromEntries(
        Object.entries(rawRecords)
          .map(([key, value]) => [key, normalizePersistedFeedbackRecord(value)])
          .filter((entry): entry is [string, PersistedFeedbackRecord] => Boolean(entry[1])),
      );
      const rawFeedbackEvents = Array.isArray(parsed.feedbackEvents) ? parsed.feedbackEvents : [];
      const feedbackEvents = rawFeedbackEvents
        .map((event) => normalizePersistedFeedbackEvent(event))
        .filter((event): event is PersistedFeedbackEvent => Boolean(event));
      const seededMigrationEvents = feedbackEvents.length > 0
        ? feedbackEvents
        : Object.values(records).map((record) => buildFeedbackEventFromRecord(record, "migration"));

      return {
        version: typeof parsed.version === "number" ? parsed.version : 1,
        records,
        feedbackEvents: seededMigrationEvents,
        rewardProfile: buildRewardProfileFromPersistedRecords(Object.values(records)),
        updatedAt: typeof parsed.updatedAt === "number" ? parsed.updatedAt : null,
      };
    } catch (error) {
      console.error("Failed to read legacy JSON learning store:", error);
      return null;
    }
  }

  private backupLegacyJsonStore() {
    if (!fs.existsSync(LEGACY_JSON_STORE_PATH)) {
      return;
    }

    ensureLegacyBackupDirectory();
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const destinationPath = path.join(LEGACY_BACKUP_DIR, `feedback-learning-pre-sqlite-${timestamp}.json`);
    fs.copyFileSync(LEGACY_JSON_STORE_PATH, destinationPath);
  }

  private createSQLiteSnapshotBackup() {
    if (!fs.existsSync(this.databasePath)) {
      return;
    }

    const walPath = `${this.databasePath}-wal`;
    if (fs.existsSync(SQLITE_STORE_BACKUP_PATH)) {
      fs.rmSync(SQLITE_STORE_BACKUP_PATH, { force: true });
    }
    if (fs.existsSync(`${SQLITE_STORE_BACKUP_PATH}-wal`)) {
      fs.rmSync(`${SQLITE_STORE_BACKUP_PATH}-wal`, { force: true });
    }
    if (fs.existsSync(`${SQLITE_STORE_BACKUP_PATH}-shm`)) {
      fs.rmSync(`${SQLITE_STORE_BACKUP_PATH}-shm`, { force: true });
    }

    if (fs.existsSync(walPath)) {
      this.db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    }
    fs.copyFileSync(this.databasePath, SQLITE_STORE_BACKUP_PATH);
  }

  private migrateLegacyJsonStoreIfNeeded() {
    if (this.getMeta("legacy_json_migrated_at")) {
      return;
    }

    const legacyStore = this.readLegacyJsonStore();
    if (!legacyStore) {
      this.setMeta("legacy_json_migrated_at", String(Date.now()));
      return;
    }

    this.backupLegacyJsonStore();
    this.createSQLiteSnapshotBackup();

    this.runInTransaction(() => {
      Object.values(legacyStore.records).forEach((record) => {
        const existingRecord = this.getRecordById(record.id);
        const mergedRecord = mergeFeedbackRecords(existingRecord, record);
        this.writeRecord(mergedRecord);
      });

      const legacyEventRows = this.db.prepare(`
        SELECT
          id,
          record_id,
          topic,
          topic_area,
          book_timestamp,
          chapters_json,
          feedback_json,
          captured_at,
          source
        FROM feedback_events
      `).all() as FeedbackEventRow[];
      const knownEventIds = new Set(
        legacyEventRows
          .map((row) => this.eventRowToEvent(row))
          .filter((event): event is PersistedFeedbackEvent => Boolean(event))
          .map((event) => event.id),
      );

      legacyStore.feedbackEvents.forEach((event) => {
        if (!knownEventIds.has(event.id)) {
          this.insertFeedbackEvent(event);
        }
      });

      const rewardProfile = this.rebuildRewardProfileCache();
      this.setMeta("legacy_json_migrated_at", String(Date.now()));
      this.setMeta("legacy_json_version", String(legacyStore.version));
      this.setMeta("schema_version", String(CURRENT_LEARNING_STORE_VERSION));
      this.setMeta("store_updated_at", String(legacyStore.updatedAt || rewardProfile.updatedAt || Date.now()));
      this.setMeta("last_reward_profile_update_at", String(rewardProfile.updatedAt || Date.now()));
    });
  }
}

export const persistentFeedbackStore = new PersistentFeedbackStore(SQLITE_STORE_PATH);
