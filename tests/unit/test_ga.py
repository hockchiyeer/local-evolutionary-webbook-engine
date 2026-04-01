import random
import unittest

from engine.ga import crossover, evolve_population, mutate, tournament_pick


def build_results(count):
    results = []
    for index in range(count):
        results.append({
            "title": f"Source {index}",
            "url": f"https://example.com/{index}",
            "content": f"Content {index}",
            "authorityScore": round(0.5 + (index * 0.03), 4),
            "informativeScore": round(0.55 + (index * 0.02), 4),
            "fitnessSeed": round(1.0 - (index * 0.07), 4),
        })
    return results


class GATests(unittest.TestCase):
    def test_tournament_selection_favors_fitter_individuals(self):
        rng = random.Random(7)
        scored_population = [
            (0.98, [0, 1, 2]),
            (0.82, [3, 4, 5]),
            (0.64, [6, 7, 8]),
            (0.36, [9, 10, 11]),
            (0.12, [12, 13, 14]),
        ]
        counts = {tuple(item[1]): 0 for item in scored_population}

        for _ in range(400):
            picked = tuple(tournament_pick(scored_population, rng, size=3))
            counts[picked] += 1

        self.assertGreater(counts[(0, 1, 2)], counts[(12, 13, 14)])
        self.assertGreater(counts[(0, 1, 2)], counts[(9, 10, 11)])

    def test_crossover_preserves_unique_target_size(self):
        rng = random.Random(11)
        parent_a = [0, 1, 2, 3]
        parent_b = [2, 4, 5, 6]

        for _ in range(12):
            child = crossover(parent_a, parent_b, target_size=4, pool_size=10, rng=rng)
            self.assertEqual(4, len(child))
            self.assertEqual(4, len(set(child)))
            self.assertTrue(all(0 <= index < 10 for index in child))

    def test_mutation_preserves_uniqueness_and_target_size(self):
        rng = random.Random(19)
        individual = [0, 1, 2, 3]
        ranked_indices = [6, 5, 4, 3, 2, 1, 0]

        for _ in range(12):
            mutated = mutate(individual, ranked_indices, target_size=4, pool_size=9, rng=rng)
            self.assertEqual(4, len(mutated))
            self.assertEqual(4, len(set(mutated)))
            self.assertTrue(all(0 <= index < 9 for index in mutated))

    def test_elitism_keeps_best_fitness_non_decreasing(self):
        results = build_results(8)
        weight_by_index = {index: result["fitnessSeed"] for index, result in enumerate(results)}

        ordered_results, history = evolve_population(
            results,
            "grid resilience planning",
            {"grid", "resilience", "planning"},
            generations=6,
            pop_size=10,
            calculate_fitness=lambda individual: round(sum(weight_by_index[index] for index in set(individual)), 6),
            marginal_gain=lambda result, _selected, _q_words: float(result.get("fitnessSeed", 0.0)),
            clamp=lambda value, lower, upper: max(lower, min(upper, value)),
        )

        self.assertTrue(ordered_results)
        self.assertGreaterEqual(len(history), 2)
        best_fitnesses = [snapshot["best_fitness"] for snapshot in history]
        self.assertEqual(best_fitnesses, sorted(best_fitnesses))

    def test_convergence_stop_triggers_on_plateau(self):
        results = build_results(7)

        _ordered_results, history = evolve_population(
            results,
            "advanced reactor supply chains",
            {"advanced", "reactor", "supply", "chains"},
            generations=10,
            pop_size=8,
            calculate_fitness=lambda _individual: 1.0,
            marginal_gain=lambda result, _selected, _q_words: float(result.get("fitnessSeed", 0.0)),
            clamp=lambda value, lower, upper: max(lower, min(upper, value)),
            stagnation_limit=2,
        )

        self.assertLess(len(history), 10)
        self.assertEqual(3, len(history))


if __name__ == "__main__":
    unittest.main()
