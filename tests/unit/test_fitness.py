import unittest

from evolution_engine import calculate_fitness, calculate_fitness_breakdown


QUERY = "enterprise ai governance and workflow adoption"


def build_population():
    return [
        {
            "url": "https://example.com/governance",
            "title": "Enterprise AI governance overview",
            "content": (
                "Enterprise AI governance defines oversight, evaluation, procurement controls, and incident response "
                "for high-impact AI deployments."
            ),
            "definitions": [
                {
                    "term": "AI Governance",
                    "description": "Operational and policy controls for responsible AI deployment.",
                    "sourceUrl": "https://example.com/governance",
                }
            ],
            "subTopics": [
                {
                    "title": "Evaluation Controls",
                    "summary": "How teams verify performance, safety, and drift.",
                    "sourceUrl": "https://example.com/governance",
                }
            ],
            "informativeScore": 0.9,
            "authorityScore": 0.84,
        },
        {
            "url": "https://example.com/adoption",
            "title": "Workflow adoption for enterprise AI",
            "content": (
                "Workflow adoption focuses on operating-model integration, change management, tooling fit, and "
                "measurement of real productivity gains."
            ),
            "definitions": [
                {
                    "term": "Workflow Adoption",
                    "description": "How organizations embed AI into recurring work processes.",
                    "sourceUrl": "https://example.com/adoption",
                }
            ],
            "subTopics": [
                {
                    "title": "Operating Model",
                    "summary": "The structure used to deploy AI into business workflows.",
                    "sourceUrl": "https://example.com/adoption",
                }
            ],
            "informativeScore": 0.88,
            "authorityScore": 0.8,
        },
        {
            "url": "https://example.com/redundant",
            "title": "Enterprise AI governance overview duplicate",
            "content": (
                "Enterprise AI governance defines oversight, evaluation, procurement controls, and incident response "
                "for high-impact AI deployments."
            ),
            "definitions": [
                {
                    "term": "AI Governance",
                    "description": "Operational and policy controls for responsible AI deployment.",
                    "sourceUrl": "https://example.com/redundant",
                }
            ],
            "subTopics": [],
            "informativeScore": 0.82,
            "authorityScore": 0.74,
        },
        {
            "url": "https://example.com/spam",
            "title": "Best AI governance tips buy now",
            "content": (
                "buy now buy now enterprise ai governance governance governance subscribe privacy policy "
                "AAAAAAAAAAA 999999999999"
            ),
            "definitions": [],
            "subTopics": [],
            "informativeScore": 0.22,
            "authorityScore": 0.28,
        },
    ]


class FitnessTests(unittest.TestCase):
    def test_diverse_coherent_selection_beats_redundant_and_spammy_selection(self):
        population = build_population()

        strong_score = calculate_fitness([0, 1], population, QUERY)
        weak_score = calculate_fitness([2, 3], population, QUERY)

        self.assertGreater(strong_score, weak_score)

    def test_fitness_remains_bounded_and_breakdown_contract_stays_stable(self):
        population = build_population()
        score = calculate_fitness([0, 1, 3], population, QUERY)
        breakdown = calculate_fitness_breakdown([0, 1, 3], population, QUERY)

        self.assertGreaterEqual(score, 0.0)
        self.assertLessEqual(score, 1.0)
        self.assertEqual(score, breakdown["total"])
        self.assertEqual(
            {
                "relevance",
                "informative",
                "authority",
                "coverage",
                "concept_diversity",
                "pairwise_diversity",
                "structure_score",
                "total",
            },
            set(breakdown.keys()),
        )


if __name__ == "__main__":
    unittest.main()
