"""Internal contracts and constants for backend-only evolutionary helpers."""

from typing import TypedDict


DEFAULT_GA_STAGNATION_LIMIT = 4
DEFAULT_GA_MIN_IMPROVEMENT = 1e-6
CHAPTER_TITLE_MAX_WORDS = 5
CHAPTER_TITLE_MAX_CHARS = 88


class SelectionFitnessBreakdown(TypedDict):
    relevance: float
    informative: float
    authority: float
    coverage: float
    concept_diversity: float
    pairwise_diversity: float
    structure_score: float
    total: float


class EvolutionGenerationSnapshot(TypedDict):
    generation: int
    best_fitness: float
    mean_fitness: float

