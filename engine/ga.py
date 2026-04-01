"""GA helpers extracted from the main engine with conservative hygiene improvements."""

import random
from typing import Any, Callable, Dict, List, MutableMapping, Sequence, Tuple

from .contracts import (
    DEFAULT_GA_MIN_IMPROVEMENT,
    DEFAULT_GA_STAGNATION_LIMIT,
    EvolutionGenerationSnapshot,
)


def greedy_seed_indices(
    all_results: Sequence[MutableMapping[str, Any]],
    q_words,
    target_size: int,
    *,
    marginal_gain: Callable[[MutableMapping[str, Any], Sequence[MutableMapping[str, Any]], Any], float],
) -> List[int]:
    selected_indices: List[int] = []
    available_indices = list(range(len(all_results)))

    while available_indices and len(selected_indices) < target_size:
        selected_results = [all_results[index] for index in selected_indices]
        best_index = max(
            available_indices,
            key=lambda index: marginal_gain(all_results[index], selected_results, q_words),
        )
        selected_indices.append(best_index)
        available_indices.remove(best_index)

    return selected_indices


def ensure_target_size(indices: Sequence[int], target_size: int, pool_size: int, rng: random.Random) -> List[int]:
    unique_indices: List[int] = []
    seen = set()
    for index in indices:
        if index in seen:
            continue
        seen.add(index)
        unique_indices.append(index)
        if len(unique_indices) >= target_size:
            break

    remaining = [index for index in range(pool_size) if index not in seen]
    rng.shuffle(remaining)
    while len(unique_indices) < target_size and remaining:
        unique_indices.append(remaining.pop())

    return unique_indices[:target_size]


def crossover(parent_a: Sequence[int], parent_b: Sequence[int], target_size: int, pool_size: int, rng: random.Random) -> List[int]:
    if target_size <= 1:
        return ensure_target_size(parent_a, target_size, pool_size, rng)

    split = rng.randint(1, target_size - 1)
    mixed = list(parent_a[:split]) + list(parent_b[split:]) + list(parent_b[:split]) + list(parent_a[split:])
    return ensure_target_size(mixed, target_size, pool_size, rng)


def mutate(
    individual: Sequence[int],
    ranked_indices: Sequence[int],
    target_size: int,
    pool_size: int,
    rng: random.Random,
) -> List[int]:
    mutated = list(individual)
    if pool_size <= target_size:
        return ensure_target_size(mutated, target_size, pool_size, rng)

    mutation_count = 1 + (1 if rng.random() < 0.15 else 0)
    fallback_pool = list(range(pool_size))
    rng.shuffle(fallback_pool)

    for _ in range(mutation_count):
        replace_index = rng.randrange(len(mutated))
        for candidate in list(ranked_indices) + fallback_pool:
            if candidate not in mutated:
                mutated[replace_index] = candidate
                break

    if rng.random() < 0.2:
        rng.shuffle(mutated)

    return ensure_target_size(mutated, target_size, pool_size, rng)


def tournament_pick(scored_population: Sequence[Tuple[float, Sequence[int]]], rng: random.Random, size: int = 4) -> List[int]:
    if len(scored_population) <= size:
        return list(max(scored_population, key=lambda item: item[0])[1])

    contestants = rng.sample(list(scored_population), size)
    return list(max(contestants, key=lambda item: item[0])[1])


def evolve_population(
    normalized_results: Sequence[MutableMapping[str, Any]],
    query: str,
    q_words,
    *,
    generations: int,
    pop_size: int,
    calculate_fitness: Callable[[Sequence[int]], float],
    marginal_gain: Callable[[MutableMapping[str, Any], Sequence[MutableMapping[str, Any]], Any], float],
    clamp: Callable[[float, float, float], float],
    stagnation_limit: int = DEFAULT_GA_STAGNATION_LIMIT,
    min_improvement: float = DEFAULT_GA_MIN_IMPROVEMENT,
) -> Tuple[List[Dict[str, Any]], List[EvolutionGenerationSnapshot]]:
    target_size = min(6, max(3, (len(normalized_results) + 1) // 2))
    target_size = min(target_size, len(normalized_results))
    rng = random.Random(sum((index + 1) * ord(char) for index, char in enumerate(query)) + (len(normalized_results) * 31))

    ranked_indices = sorted(
        range(len(normalized_results)),
        key=lambda index: marginal_gain(normalized_results[index], [], q_words),
        reverse=True,
    )

    population: List[List[int]] = []
    population_keys = set()
    history: List[EvolutionGenerationSnapshot] = []

    def add_to_population(candidate: Sequence[int]) -> bool:
        normalized_candidate = tuple(sorted(ensure_target_size(candidate, target_size, len(normalized_results), rng)))
        if normalized_candidate in population_keys:
            return False
        population_keys.add(normalized_candidate)
        population.append(list(normalized_candidate))
        return True

    add_to_population(greedy_seed_indices(normalized_results, q_words, target_size, marginal_gain=marginal_gain))

    authority_ranked = sorted(
        range(len(normalized_results)),
        key=lambda index: float(normalized_results[index].get("authorityScore", 0.5)),
        reverse=True,
    )
    informative_ranked = sorted(
        range(len(normalized_results)),
        key=lambda index: float(normalized_results[index].get("informativeScore", 0.5)),
        reverse=True,
    )

    for seed_indices in (ranked_indices, authority_ranked, informative_ranked):
        add_to_population(seed_indices[:target_size])

    for offset in range(min(len(ranked_indices), target_size + 3)):
        add_to_population(ranked_indices[offset:offset + target_size])

    attempts = 0
    while len(population) < pop_size and attempts < 100:
        attempts += 1
        candidate: List[int] = []
        focus_pool = ranked_indices[:max(target_size * 2, min(len(ranked_indices), 4))]
        while len(candidate) < target_size:
            chosen = rng.choice(focus_pool) if focus_pool and rng.random() < 0.7 else rng.randrange(len(normalized_results))
            if chosen not in candidate:
                candidate.append(chosen)
        add_to_population(candidate)

    stagnation_generations = 0
    best_seen_fitness = float("-inf")

    for generation in range(1, generations + 1):
        scored_population = [
            (calculate_fitness(individual), individual)
            for individual in population
        ]
        scored_population.sort(key=lambda item: item[0], reverse=True)

        best_fitness = scored_population[0][0]
        mean_fitness = sum(score for score, _ in scored_population) / max(len(scored_population), 1)
        history.append({
            "generation": generation,
            "best_fitness": round(best_fitness, 6),
            "mean_fitness": round(mean_fitness, 6),
        })

        if best_fitness > (best_seen_fitness + min_improvement):
            best_seen_fitness = best_fitness
            stagnation_generations = 0
        else:
            stagnation_generations += 1

        elite_count = max(2, pop_size // 6)
        next_population = [list(individual) for _, individual in scored_population[:elite_count]]

        greedy_candidate = greedy_seed_indices(normalized_results, q_words, target_size, marginal_gain=marginal_gain)
        if greedy_candidate not in next_population:
            next_population.append(greedy_candidate)

        while len(next_population) < pop_size:
            parent_a = tournament_pick(scored_population, rng)
            parent_b = tournament_pick(scored_population, rng)
            child = crossover(parent_a, parent_b, target_size, len(normalized_results), rng)
            if rng.random() < 0.60:
                child = mutate(child, ranked_indices, target_size, len(normalized_results), rng)
            next_population.append(child)

        population = []
        population_keys = set()
        for candidate in next_population:
            add_to_population(candidate)

        attempts = 0
        while len(population) < pop_size and attempts < 50:
            attempts += 1
            add_to_population(rng.sample(range(len(normalized_results)), target_size))

        if generation >= 3 and stagnation_generations >= stagnation_limit:
            break

    final_scored_population = [
        (calculate_fitness(individual), individual)
        for individual in population
    ]
    final_scored_population.sort(key=lambda item: item[0], reverse=True)
    best_indices = []
    seen_indices = set()
    for index in final_scored_population[0][1]:
        if index in seen_indices:
            continue
        seen_indices.add(index)
        best_indices.append(index)

    ordered_indices: List[int] = []
    remaining = best_indices[:]
    while remaining:
        current_selection = [normalized_results[index] for index in ordered_indices]
        best_next_index = max(
            remaining,
            key=lambda index: marginal_gain(normalized_results[index], current_selection, q_words),
        )
        ordered_indices.append(best_next_index)
        remaining.remove(best_next_index)

    ordered_results: List[Dict[str, Any]] = []
    current_selection: List[Dict[str, Any]] = []
    for index in ordered_indices:
        result = dict(normalized_results[index])
        result["fitness"] = round(clamp(marginal_gain(result, current_selection, q_words), 0.0, 1.0), 6)
        for key in list(result.keys()):
            if key.startswith("_"):
                del result[key]
        ordered_results.append(result)
        current_selection.append(result)

    return ordered_results, history

