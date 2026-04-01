import unittest

from engine.fallback import build_adaptive_fallback_results
from engine.search import rank_frontier_results, should_supplement_with_fallback
from evolution_engine import (
    expand_query_focus_words,
    normalize_space,
    normalize_term_key,
    query_words,
    source_relevance,
    tokenize,
)
from evolution_engine import get_fallback_query, get_mock_results, search_web


class AdaptiveFallbackTests(unittest.TestCase):
    def test_query_driven_fallback_results_follow_arbitrary_topic_terms(self):
        query = "quantum battery recycling supply chain resilience"
        results = get_mock_results(query)

        self.assertGreaterEqual(len(results), 6)
        combined = " ".join(f"{item['title']} {item['content']}" for item in results[:4]).lower()
        for token in ("quantum", "battery", "recycling"):
            self.assertIn(token, combined)
        self.assertNotIn("malaysia", combined)
        self.assertNotIn("artificial intelligence", combined)

    def test_generic_fallback_query_stays_topic_driven(self):
        query = "grid edge storage economics in southeast asia"
        fallback_query = get_fallback_query(query)

        self.assertTrue(any(token in fallback_query for token in ("grid", "storage", "economics")))
        self.assertNotIn("Bursa Malaysia", fallback_query)

    def test_person_name_fallback_query_expands_for_biographical_retrieval(self):
        fallback_query = get_fallback_query("Mahathir Mohammad")

        self.assertIn("mahathir", fallback_query.lower())
        self.assertIn("biography", fallback_query.lower())
        self.assertIn("career", fallback_query.lower())

    def test_search_uses_adaptive_fallback_when_live_sources_are_disabled(self):
        query = "ammonia shipping fuel infrastructure"
        results = search_web(
            query,
            {
                "sources": {
                    "wikipedia": False,
                    "duckduckgo": False,
                    "google": False,
                    "bing": False,
                },
                "manualUrls": [],
                "disableMockFallback": False,
            },
        )

        self.assertTrue(results)
        combined_titles = " ".join(result["title"] for result in results[:5]).lower()
        self.assertIn("ammonia", combined_titles)
        self.assertTrue(any(label in combined_titles for label in ("foundations", "drivers", "systems", "outlook")))

    def test_person_name_fallback_uses_biography_style_facets(self):
        query = "Mahathir Mohammad"
        results = get_mock_results(query)

        combined_titles = " ".join(result["title"] for result in results[:6]).lower()
        combined_content = " ".join(result["content"] for result in results[:3]).lower()
        self.assertTrue(
            any(term in combined_titles for term in ("background", "career", "leadership", "legacy"))
        )
        self.assertTrue(
            any(term in combined_content for term in ("public figure", "biographical", "career milestones", "legacy"))
        )
        self.assertNotIn("applications: mahathir", combined_titles)
        self.assertNotIn("constraints: mahathir", combined_titles)

    def test_strong_real_frontier_does_not_trigger_fallback(self):
        query = "grid resilience planning"
        decision = should_supplement_with_fallback(
            rank_frontier_results(
                [
                    {
                        "url": "https://energy.edu/reference",
                        "title": "Grid resilience planning overview",
                        "content": (
                            "Grid resilience planning is a framework for electric reliability, emergency response, "
                            "asset hardening, and recovery planning across utility networks."
                        ),
                        "definitions": [
                            {
                                "term": "Grid Resilience Planning",
                                "description": "Framework for continuity under power-system disruption.",
                                "sourceUrl": "https://energy.edu/reference",
                            }
                        ],
                        "subTopics": [
                            {
                                "title": "Recovery Planning",
                                "summary": "How systems restore service after severe events.",
                                "sourceUrl": "https://energy.edu/reference",
                            }
                        ],
                        "informativeScore": 0.86,
                        "authorityScore": 0.9,
                    },
                    {
                        "url": "https://grid.gov/guide",
                        "title": "Electric grid resilience guide",
                        "content": (
                            "Electric grid resilience guidance describes emergency operations, redundancy, black-start "
                            "capabilities, and infrastructure modernization for utilities and regulators."
                        ),
                        "definitions": [
                            {
                                "term": "Electric Grid Resilience",
                                "description": "Capability of a power system to absorb and recover from disruptions.",
                                "sourceUrl": "https://grid.gov/guide",
                            }
                        ],
                        "subTopics": [],
                        "informativeScore": 0.83,
                        "authorityScore": 0.92,
                    },
                    {
                        "url": "https://example.com/grid-operations",
                        "title": "Grid operations and emergency response",
                        "content": (
                            "Operators improve resilience through monitoring, emergency drills, mutual aid, and "
                            "targeted upgrades in transmission and distribution assets."
                        ),
                        "definitions": [],
                        "subTopics": [],
                        "informativeScore": 0.78,
                        "authorityScore": 0.74,
                    },
                    {
                        "url": "https://example.com/planning",
                        "title": "Resilience planning for utilities",
                        "content": (
                            "Utilities align scenario planning, asset prioritization, and restoration processes to "
                            "improve resilience outcomes."
                        ),
                        "definitions": [],
                        "subTopics": [],
                        "informativeScore": 0.76,
                        "authorityScore": 0.72,
                    },
                    {
                        "url": "https://example.com/standards",
                        "title": "Standards for grid continuity and resilience",
                        "content": (
                            "Standards define risk evaluation, asset criticality, and continuity expectations for "
                            "resilient grid systems."
                        ),
                        "definitions": [],
                        "subTopics": [],
                        "informativeScore": 0.75,
                        "authorityScore": 0.73,
                    },
                    {
                        "url": "https://example.com/resilience-metrics",
                        "title": "Metrics for grid resilience",
                        "content": (
                            "Common resilience metrics include outage duration, restoration time, and continuity "
                            "performance under adverse conditions."
                        ),
                        "definitions": [],
                        "subTopics": [],
                        "informativeScore": 0.74,
                        "authorityScore": 0.71,
                    },
                ],
                query,
                query_words=query_words,
                expand_query_focus_words=expand_query_focus_words,
                tokenize=tokenize,
                normalize_space=normalize_space,
                source_relevance=source_relevance,
            ),
            query,
            query_words=query_words,
            expand_query_focus_words=expand_query_focus_words,
            tokenize=tokenize,
            normalize_space=normalize_space,
            source_relevance=source_relevance,
        )

        self.assertEqual(0.0, decision["should_use_fallback"])
        self.assertEqual(0.0, decision["desired_count"])

    def test_cached_fallback_results_return_clean_clones(self):
        query = "synthetic biology biomanufacturing pathways"
        first = build_adaptive_fallback_results(
            query,
            (),
            desired_count=4,
            tokenize=tokenize,
            stop_words=set(),
            normalize_space=normalize_space,
            normalize_term_key=normalize_term_key,
            unique_preserve_order=lambda values: list(dict.fromkeys(values)),
            build_definition_candidates=lambda title, content, url: [{"term": title, "description": content, "sourceUrl": url}],
            build_subtopic_candidates=lambda title, content, raw_query, url: [{"title": title, "summary": content, "sourceUrl": url}],
        )
        original_title = first[0]["title"]
        first[0]["title"] = "mutated title"

        second = build_adaptive_fallback_results(
            query,
            (),
            desired_count=4,
            tokenize=tokenize,
            stop_words=set(),
            normalize_space=normalize_space,
            normalize_term_key=normalize_term_key,
            unique_preserve_order=lambda values: list(dict.fromkeys(values)),
            build_definition_candidates=lambda title, content, url: [{"term": title, "description": content, "sourceUrl": url}],
            build_subtopic_candidates=lambda title, content, raw_query, url: [{"title": title, "summary": content, "sourceUrl": url}],
        )

        self.assertEqual(original_title, second[0]["title"])
        self.assertNotEqual(first[0]["title"], second[0]["title"])

    def test_fallback_results_are_weighted_below_comparable_real_results(self):
        query = "advanced reactor supply chains"
        real_result = {
            "url": "https://energy.edu/reactor",
            "title": "Advanced reactor supply chains overview",
            "content": (
                "Advanced reactor supply chains cover fuel, forgings, controls, and manufacturing capacity across "
                "the nuclear value chain."
            ),
            "definitions": [
                {
                    "term": "Advanced Reactor Supply Chains",
                    "description": "Industrial systems supporting advanced nuclear deployment.",
                    "sourceUrl": "https://energy.edu/reactor",
                }
            ],
            "subTopics": [],
            "informativeScore": 0.82,
            "authorityScore": 0.88,
        }
        fallback_result = build_adaptive_fallback_results(
            query,
            (),
            desired_count=1,
            tokenize=tokenize,
            stop_words={"the", "and", "of", "to"},
            normalize_space=normalize_space,
            normalize_term_key=normalize_term_key,
            unique_preserve_order=lambda values: list(dict.fromkeys(values)),
            build_definition_candidates=lambda title, content, url: [{"term": title, "description": content, "sourceUrl": url}],
            build_subtopic_candidates=lambda title, content, raw_query, url: [{"title": title, "summary": content, "sourceUrl": url}],
        )[0]

        ranked = rank_frontier_results(
            [fallback_result, real_result],
            query,
            query_words=query_words,
            expand_query_focus_words=expand_query_focus_words,
            tokenize=tokenize,
            normalize_space=normalize_space,
            source_relevance=source_relevance,
        )

        self.assertEqual(real_result["url"], ranked[0]["url"])


if __name__ == "__main__":
    unittest.main()
