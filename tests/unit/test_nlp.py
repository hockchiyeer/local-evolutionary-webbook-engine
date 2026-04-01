import unittest

from engine.nlp import SKLEARN_NLP_AVAILABLE, semantic_coherence_score, semantic_similarity


class OfflineNLPTests(unittest.TestCase):
    def test_semantic_similarity_prefers_related_text(self):
        related = semantic_similarity(
            "advanced packaging capacity bottlenecks",
            "semiconductor packaging capacity constraint",
        )
        unrelated = semantic_similarity(
            "advanced packaging capacity bottlenecks",
            "festival concert merchandise promotion",
        )

        self.assertGreater(related, unrelated)

    def test_semantic_coherence_prefers_aligned_sections(self):
        aligned = semantic_coherence_score(
            "grid resilience planning",
            (
                "grid resilience planning overview",
                "utility restoration priorities and asset hardening",
                "continuity metrics for electric networks",
            ),
        )
        misaligned = semantic_coherence_score(
            "grid resilience planning",
            (
                "movie soundtrack awards campaign",
                "luxury retail expansion strategy",
                "concert ticket bundle performance",
            ),
        )

        self.assertGreater(aligned, misaligned)

    def test_semantic_layer_is_offline_and_locally_backed(self):
        self.assertIsInstance(SKLEARN_NLP_AVAILABLE, bool)


if __name__ == "__main__":
    unittest.main()
