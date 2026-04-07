import "dotenv/config";
import express from "express";
import { createServer as createViteServer } from "vite";
import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import cors from "cors";
import { persistentFeedbackStore } from "./feedbackStore";
import type { ChapterFeedback, FeedbackIssueTag, FeedbackSignal, RewardProfile, RewardWeightProfile, WebBookFeedback } from "./src/types";

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

type PersistedLearningStore = {
  version: number;
  records: Record<string, PersistedFeedbackRecord>;
  feedbackEvents: PersistedFeedbackEvent[];
  rewardProfile: RewardProfile;
  updatedAt: number | null;
};

const CURRENT_LEARNING_STORE_VERSION = 2;
const LEARNING_STORE_PATH = path.join(process.cwd(), "data", "feedback-learning.json");
const LEARNING_BACKUP_DIR = path.join(process.cwd(), "data", "backups");
const MAX_LEARNING_BACKUPS = 20;

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
  return Array.from(new Set(value.filter((entry): entry is FeedbackIssueTag => typeof entry === "string" && FEEDBACK_TAG_SET.has(entry as FeedbackIssueTag))));
};

const normalizeCustomTags = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];

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

const createEmptyLearningStore = (): PersistedLearningStore => ({
  version: CURRENT_LEARNING_STORE_VERSION,
  records: {},
  feedbackEvents: [],
  rewardProfile: createEmptyRewardProfile(),
  updatedAt: null,
});

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
    ? candidate.chapters
        .map((chapter, index) => ({
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
    ? candidate.chapters
        .map((chapter, index) => ({
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

const ensureLearningStoreDirectory = () => {
  fs.mkdirSync(path.dirname(LEARNING_STORE_PATH), { recursive: true });
};

const ensureLearningBackupDirectory = () => {
  fs.mkdirSync(LEARNING_BACKUP_DIR, { recursive: true });
};

const readLearningStore = (): PersistedLearningStore => {
  try {
    if (!fs.existsSync(LEARNING_STORE_PATH)) {
      return createEmptyLearningStore();
    }

    const raw = fs.readFileSync(LEARNING_STORE_PATH, "utf8");
    if (!raw.trim()) {
      return createEmptyLearningStore();
    }

    const parsed = JSON.parse(raw) as Partial<PersistedLearningStore> & {
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
    console.error("Failed to read persistent learning store:", error);
    return createEmptyLearningStore();
  }
};

const writeLearningStore = (store: PersistedLearningStore) => {
  ensureLearningStoreDirectory();
  const payload: PersistedLearningStore = {
    version: CURRENT_LEARNING_STORE_VERSION,
    records: store.records,
    feedbackEvents: store.feedbackEvents,
    rewardProfile: normalizeRewardProfile(store.rewardProfile),
    updatedAt: store.updatedAt,
  };
  const serializedPayload = JSON.stringify(payload, null, 2);
  const currentSerializedPayload = fs.existsSync(LEARNING_STORE_PATH)
    ? fs.readFileSync(LEARNING_STORE_PATH, "utf8")
    : "";

  if (currentSerializedPayload === serializedPayload) {
    return;
  }

  if (currentSerializedPayload.trim()) {
    ensureLearningBackupDirectory();
    const backupTimestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backupPath = path.join(LEARNING_BACKUP_DIR, `feedback-learning-${backupTimestamp}.json`);
    fs.writeFileSync(backupPath, currentSerializedPayload, "utf8");

    const backupFiles = fs.readdirSync(LEARNING_BACKUP_DIR)
      .filter((file) => file.startsWith("feedback-learning-") && file.endsWith(".json"))
      .sort()
      .reverse();
    backupFiles.slice(MAX_LEARNING_BACKUPS).forEach((file) => {
      fs.unlinkSync(path.join(LEARNING_BACKUP_DIR, file));
    });
  }

  const tempPath = `${LEARNING_STORE_PATH}.tmp`;
  fs.writeFileSync(tempPath, serializedPayload, "utf8");
  fs.renameSync(tempPath, LEARNING_STORE_PATH);
};

const resolveEffectiveRewardProfile = (candidate: unknown): RewardProfile => (
  persistentFeedbackStore.resolveEffectiveRewardProfile(candidate)
);

const upsertLearningRecords = (entries: unknown[]) => (
  persistentFeedbackStore.upsertLearningRecords(entries)
);

async function startServer() {
  const app = express();
  const PORT = 3000;
  const SEARCH_REQUEST_TIMEOUT_MS = 420000;
  const EXTENDED_REQUEST_TIMEOUT_MS = 480000;

  // Bring the persistent feedback store online before requests start so
  // adaptive reward profiles and JSON-to-SQLite migration are ready.
  persistentFeedbackStore.initialize();

  app.use(cors());
  app.use(express.json({ limit: "10mb" }));
  app.use((error: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (!error) {
      return next();
    }

    if (error.type === "entity.too.large") {
      return res.status(413).json({ error: "Request payload is too large for the evolution server." });
    }

    if (error instanceof SyntaxError && "body" in error) {
      return res.status(400).json({ error: "Invalid JSON request body." });
    }

    console.error("Request parsing error:", error);
    return res.status(500).json({ error: "Failed to parse the incoming request." });
  });

  // API Routes for evolution
  app.post("/api/search", (req, res) => {
    const { query, sourceConfig } = req.body;
    if (!query) return res.status(400).json({ error: "Query is required" });
    runPython("search", query, sourceConfig || {}, res);
  });

  app.post("/api/feedback/profile", (_req, res) => {
    res.json(persistentFeedbackStore.getSummary());
  });

  app.post("/api/feedback/upsert", (req, res) => {
    const { book } = req.body;
    if (!book) {
      return res.status(400).json({ error: "Book feedback payload is required" });
    }

    try {
      res.json(upsertLearningRecords([book]));
    } catch (error: any) {
      console.error("Failed to persist learning record:", error);
      res.status(500).json({ error: "Failed to persist feedback learning record", details: error?.message });
    }
  });

  app.post("/api/feedback/bootstrap", (req, res) => {
    const { books } = req.body;
    if (!Array.isArray(books)) {
      return res.status(400).json({ error: "Books payload must be an array" });
    }

    try {
      res.json(upsertLearningRecords(books));
    } catch (error: any) {
      console.error("Failed to bootstrap learning records:", error);
      res.status(500).json({ error: "Failed to bootstrap feedback learning records", details: error?.message });
    }
  });

  app.post("/api/evolve", (req, res) => {
    const { query, population, generations, rewardProfile } = req.body;
    if (!query || !population) return res.status(400).json({ error: "Query and population are required" });
    const effectiveRewardProfile = resolveEffectiveRewardProfile(rewardProfile);
    runPython("evolve", query, { population, generations, rewardProfile: effectiveRewardProfile }, res);
  });

  app.post("/api/assemble", (req, res) => {
    const { query, population, rewardProfile } = req.body;
    if (!query || !population) return res.status(400).json({ error: "Query and population are required" });
    const effectiveRewardProfile = resolveEffectiveRewardProfile(rewardProfile);
    runPython("assemble", query, { population, rewardProfile: effectiveRewardProfile }, res);
  });

  function runPython(mode: string, query: string, data: any, res: any) {
    const args = ["evolution_engine.py", mode, query];
    const requestTimeoutMs = mode === "search"
      ? SEARCH_REQUEST_TIMEOUT_MS
      : EXTENDED_REQUEST_TIMEOUT_MS;

    let dataChunks: Buffer[] = [];
    let errorString = "";
    let responded = false;
    let timedOut = false;

    const sendJsonError = (status: number, payload: Record<string, unknown>) => {
      if (responded || res.headersSent) return;
      responded = true;
      res.status(status).json(payload);
    };

    const pythonCmd = process.platform === "win32" ? "python" : "python3";
    let pythonProcess: any = null;
    let timeoutHandle: NodeJS.Timeout;

    function setupProcessHandlers(proc: any) {
      if (!proc) return;

      if (data !== null && data !== undefined) {
        proc.stdin.on("error", (error: any) => {
          console.error(`Failed to write request payload to Python stdin: ${error.message}`);
          // Don't necessarily fail the whole thing if stdin write fails, 
          // but we should log it. The process might still be running.
        });
        try {
          proc.stdin.write(JSON.stringify(data));
        } catch (e: any) {
          console.error(`Error writing to stdin: ${e.message}`);
        }
      }
      proc.stdin.end();

      proc.stdout.on("data", (d: Buffer | string) => dataChunks.push(Buffer.isBuffer(d) ? d : Buffer.from(d)));
      proc.stderr.on("data", (d: any) => errorString += d.toString());

      proc.on("error", (error: any) => {
        // This is handled by the initial spawn logic for fallback, 
        // but we keep it here as a safety net.
        if (responded) return;
        console.error(`Python process error: ${error.message}`);
      });

      proc.on("close", (code: number) => {
        if (timeoutHandle) clearTimeout(timeoutHandle);
        if (responded || timedOut) return;

        if (code !== 0) {
          console.error(`Python process exited with code ${code}: ${errorString}`);
          return sendJsonError(500, { 
            error: "Evolution engine failed", 
            details: errorString || `Process exited with code ${code}` 
          });
        }
        
        const dataString = Buffer.concat(dataChunks).toString('utf8');
        const trimmedOutput = dataString.trim();
        if (!trimmedOutput) {
          console.error(`Python process returned empty output for mode ${mode}`);
          return sendJsonError(500, { error: "Evolution engine returned empty output" });
        }

        try {
          const result = JSON.parse(trimmedOutput);
          if (result.error) return sendJsonError(500, result);
          responded = true;
          res.json(result);
        } catch (e) {
          console.error(`Failed to parse Python output for mode ${mode}. Output length: ${dataString.length}`);
          console.error(`Output start: ${dataString.substring(0, 500)}`);
          console.error(`Output end: ${dataString.substring(dataString.length - 500)}`);
          sendJsonError(500, { 
            error: "Invalid output from evolution engine", 
            details: "The engine returned data that could not be parsed as JSON. This usually happens when the engine crashes or prints non-JSON warnings. Check server logs." 
          });
        }
      });
    }

    const startProcess = (cmd: string) => {
      try {
        const proc = spawn(cmd, args, {
          env: { ...process.env, PYTHONIOENCODING: "utf-8" }
        });
        
        proc.on("error", (err: any) => {
          if (responded) return;
          
          if (err.code === 'ENOENT' && cmd === 'python3') {
            console.warn("python3 not found, falling back to python");
            startProcess('python');
          } else {
            if (timeoutHandle) clearTimeout(timeoutHandle);
            console.error(`Failed to start Python process (${cmd}): ${err.message}`);
            sendJsonError(500, { error: "Evolution engine failed to start", details: err.message });
          }
        });

        // Only setup handlers if we didn't immediately fail (though error event is async)
        setupProcessHandlers(proc);
        pythonProcess = proc;
      } catch (e: any) {
        if (timeoutHandle) clearTimeout(timeoutHandle);
        console.error(`Exception during spawn: ${e.message}`);
        sendJsonError(500, { error: "Failed to spawn evolution engine", details: e.message });
      }
    };

    timeoutHandle = setTimeout(() => {
      timedOut = true;
      if (pythonProcess) {
        try {
          pythonProcess.kill();
        } catch (error) {
          console.error("Failed to terminate timed-out Python process:", error);
        }
      }
      console.error(`Python ${mode} request timed out after ${requestTimeoutMs}ms`);
      sendJsonError(504, {
        error: `Evolution engine ${mode} request timed out.`,
        details: `The backend did not respond within ${Math.round(requestTimeoutMs / 1000)} seconds.`,
      });
    }, requestTimeoutMs);

    startProcess(pythonCmd);
  }

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
