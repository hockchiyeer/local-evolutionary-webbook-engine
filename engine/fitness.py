"""Selection fitness helpers extracted from the main engine."""

from typing import Any, Callable, Mapping, MutableMapping, Sequence, Set, Tuple

from .contracts import SelectionFitnessBreakdown
from .reinforcement import normalize_reward_profile


def calculate_selection_fitness(
    individual: Sequence[int],
    all_results: Sequence[MutableMapping[str, Any]],
    query: str,
    *,
    unique_preserve_order: Callable[[Sequence[int]], Sequence[int]],
    query_words: Callable[[str], Set[str]],
    expand_query_focus_words: Callable[[Set[str]], Set[str]],
    source_relevance: Callable[[MutableMapping[str, Any], Set[str]], float],
    tokenize: Callable[[str], Sequence[str]],
    extract_key_concepts: Callable[[str], Set[str]],
    extract_concept_keys: Callable[[MutableMapping[str, Any]], Set[str]],
    content_signature_tokens: Callable[[str], Set[str]],
    jaccard_similarity: Callable[[Set[str], Set[str]], float],
    average: Callable[[Sequence[float], float], float],
    reward_profile: Mapping[str, Any] | None = None,
) -> Tuple[float, SelectionFitnessBreakdown]:
    unique_indices = unique_preserve_order(individual)
    if not unique_indices:
        return 0.0, {
            "relevance": 0.0,
            "informative": 0.0,
            "authority": 0.0,
            "coverage": 0.0,
            "concept_diversity": 0.0,
            "pairwise_diversity": 0.0,
            "structure_score": 0.0,
            "total": 0.0,
        }

    selected_results = [all_results[index] for index in unique_indices]
    q_words = query_words(query)
    focus_words = expand_query_focus_words(q_words)

    relevance = average([source_relevance(result, q_words) for result in selected_results], 0.0)
    informative = average([float(result.get("informativeScore", 0.5)) for result in selected_results], 0.5)
    authority = average([float(result.get("authorityScore", 0.5)) for result in selected_results], 0.5)
    semantic_coherence = average([float(result.get("_semantic_coherence", 0.55)) for result in selected_results], 0.55)
    spam_risk = average([float(result.get("_spam_risk", 0.0)) for result in selected_results], 0.0)

    coverage_words = set()
    concept_seen = set()
    concept_novelties = []
    pairwise_overlaps = []

    for position, result in enumerate(selected_results):
        result_words = result.get("_words")
        if result_words is None:
            result_words = set(tokenize(result.get("title", "") + " " + result.get("content", "")))

        coverage_words.update(result_words.intersection(focus_words))

        concept_keys = result.get("_concept_keys")
        if concept_keys is None:
            concept_keys = extract_concept_keys(result)

        if concept_keys:
            overlap = len(concept_keys.intersection(concept_seen)) / max(len(concept_keys), 1)
            concept_novelties.append(1.0 - overlap)
            concept_seen.update(concept_keys)
        else:
            concept_novelties.append(0.55)

        current_signature = result.get("_signature")
        if current_signature is None:
            current_signature = content_signature_tokens(result.get("content", ""))

        for previous in selected_results[:position]:
            previous_signature = previous.get("_signature")
            if previous_signature is None:
                previous_signature = content_signature_tokens(previous.get("content", ""))
            pairwise_overlaps.append(jaccard_similarity(current_signature, previous_signature))

    coverage = len(coverage_words) / max(len(focus_words), 1) if focus_words else 1.0
    concept_diversity = average(concept_novelties, 0.6)
    pairwise_diversity = 1.0 - average(pairwise_overlaps, 0.0)
    structure_score = min(
        (
            sum(len(result.get("definitions", []) or []) for result in selected_results)
            + sum(len(result.get("subTopics", []) or []) for result in selected_results)
        ) / max(len(selected_results) * 8, 1),
        1.0,
    )

    normalized_reward_profile = normalize_reward_profile(reward_profile)
    reward_weights = normalized_reward_profile["weights"]
    weighted_components = {
        "relevance": 0.25 * reward_weights["relevance"],
        "informative": 0.20 * reward_weights["evidenceDensity"],
        "authority": 0.18 * reward_weights["authority"],
        "coverage": 0.14 * reward_weights["coverage"],
        "concept_diversity": 0.13 * reward_weights["diversity"],
        "structure_score": 0.10 * reward_weights["structure"],
    }
    weight_total = sum(weighted_components.values()) or 1.0

    score = (
        (relevance * weighted_components["relevance"])
        + (informative * weighted_components["informative"])
        + (authority * weighted_components["authority"])
        + (coverage * weighted_components["coverage"])
        + (concept_diversity * weighted_components["concept_diversity"])
        + (structure_score * weighted_components["structure_score"])
    ) / weight_total
    score *= (0.65 + (0.35 * pairwise_diversity)) * (0.88 + (0.12 * reward_weights["antiRedundancy"]))
    score += semantic_coherence * 0.035 * reward_weights["coherence"]
    score -= spam_risk * 0.055
    total = round(min(max(score, 0.0), 1.0), 6)

    return total, {
        "relevance": round(relevance, 6),
        "informative": round(informative, 6),
        "authority": round(authority, 6),
        "coverage": round(coverage, 6),
        "concept_diversity": round(concept_diversity, 6),
        "pairwise_diversity": round(pairwise_diversity, 6),
        "structure_score": round(structure_score, 6),
        "total": total,
    }
