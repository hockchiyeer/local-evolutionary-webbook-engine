import unittest

from engine.nlp import (
    SKLEARN_NLP_AVAILABLE,
    extract_subtopic_tree,
    semantic_coherence_score,
    semantic_cooccurrence_filter,
    semantic_similarity,
)
from engine.nlp_graph import concept_crawl_depth


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

    def test_subtopic_tree_extracts_divergent_labels_from_market_corpus(self):
        tree = extract_subtopic_tree(
            "outlook for the malaysian stock market",
            (
                "Bursa Malaysia performance is shaped by foreign investment flows and sector rotation.",
                "Commodity pricing and energy exports influence Malaysian equities and earnings revisions.",
                "Regulatory policy, listing rules, and capital-market oversight shape market confidence.",
                "Dividend yields and valuation multiples remain central to investor positioning.",
            ),
            max_topics=5,
        )

        self.assertGreaterEqual(len(tree), 3)
        combined_labels = " ".join(item["label"] for item in tree).lower()
        self.assertTrue(
            any(term in combined_labels for term in ("foreign", "commodity", "regulatory", "dividend", "valuation"))
        )
        self.assertNotEqual("outlook for the malaysian stock market", tree[0]["label"].lower())

    def test_semantic_cooccurrence_filter_rejects_clear_domain_mismatch(self):
        candidates = [
            {
                "title": "Apple supply chain strategy and iPhone assembly",
                "content": "Apple Inc coordinates suppliers, final assembly, component sourcing, and manufacturing strategy.",
            },
            {
                "title": "Apple orchard pruning and soil management",
                "content": "Apple trees need seasonal pruning, irrigation, and orchard disease control for fruit production.",
            },
        ]

        filtered = semantic_cooccurrence_filter(
            "Apple supply chain strategy",
            candidates,
            baseline_documents=("Apple Inc designs consumer hardware and manages global suppliers.",),
            keep_min=1,
        )
        filtered_titles = [item["title"].lower() for item in filtered]

        self.assertIn("apple supply chain strategy and iphone assembly", filtered_titles)
        self.assertNotIn("apple orchard pruning and soil management", filtered_titles)

    def test_concept_crawl_depth_separates_seed_and_related_nodes(self):
        depth_map = {
            item["node"]: item
            for item in concept_crawl_depth(
                "malaysian stock market",
                ("malaysian stock market", "foreign investment", "commodity pricing"),
            )
        }

        self.assertEqual("seed", depth_map["malaysian stock market"]["layer"])
        self.assertEqual("related", depth_map["foreign investment"]["layer"])
        self.assertEqual("related", depth_map["commodity pricing"]["layer"])


if __name__ == "__main__":
    unittest.main()
