import unittest

from engine.search import enrich_frontier_results, rank_frontier_results, sanitize_search_snippet
from evolution_engine import dedupe_results, normalize_source_config
from evolution_engine import expand_query_focus_words, normalize_space, query_words, source_relevance, tokenize


class SearchNormalizeTests(unittest.TestCase):
    def test_normalize_source_config_normalizes_and_limits_manual_urls(self):
        config = {
            "sources": {
                "wikipedia": False,
                "google": True,
            },
            "manualUrls": [
                "example.com/a",
                "https://example.com/a",
                "https://example.com/b",
                "https://example.com/c",
                "https://example.com/d",
                "https://example.com/e",
                "https://example.com/f",
                "https://example.com/g",
                "https://example.com/h",
                "javascript:alert(1)",
            ],
            "disableMockFallback": True,
        }

        normalized = normalize_source_config(config)

        self.assertFalse(normalized["sources"]["wikipedia"])
        self.assertTrue(normalized["sources"]["google"])
        self.assertTrue(normalized["disableMockFallback"])
        self.assertEqual(8, len(normalized["manualUrls"]))
        self.assertEqual("https://example.com/a", normalized["manualUrls"][0])
        self.assertNotIn("javascript:alert(1)", normalized["manualUrls"])

    def test_dedupe_results_merges_duplicate_provider_metadata(self):
        query = "AI strategy"
        results = [
            {
                "url": "https://example.com/a",
                "title": "AI Strategy Overview",
                "content": "Short overview of AI strategy and execution.",
                "definitions": [
                    {
                        "term": "AI Strategy",
                        "description": "A plan for prioritizing AI investments and execution.",
                        "sourceUrl": "https://example.com/a",
                    }
                ],
                "subTopics": [],
                "searchProvider": "google",
                "searchProviders": ["google"],
            },
            {
                "url": "https://example.com/a",
                "title": "AI Strategy Overview",
                "content": (
                    "Longer overview of AI strategy, execution, governance, measurement, and operating-model choices "
                    "across enterprise functions."
                ),
                "definitions": [
                    {
                        "term": "Operating Model",
                        "description": "How teams, governance, and workflows support AI execution.",
                        "sourceUrl": "https://example.com/a",
                    }
                ],
                "subTopics": [
                    {
                        "title": "Execution Planning",
                        "summary": "Sequencing AI work into delivery milestones and control points.",
                        "sourceUrl": "https://example.com/a",
                    }
                ],
                "searchProvider": "manual",
                "searchProviders": ["manual"],
            },
        ]

        deduped = dedupe_results(results, query)

        self.assertEqual(1, len(deduped))
        merged = deduped[0]
        self.assertIn("google", merged["searchProviders"])
        self.assertIn("manual", merged["searchProviders"])
        self.assertIn("governance", merged["content"].lower())
        definition_terms = {definition["term"] for definition in merged["definitions"]}
        self.assertIn("AI Strategy", definition_terms)
        self.assertIn("Operating Model", definition_terms)
        self.assertTrue(merged["subTopics"])

    def test_frontier_ranking_prefers_definitional_depth_over_shallow_listicle(self):
        query = "carbon accounting standards"
        ranked = rank_frontier_results(
            [
                {
                    "url": "https://example.com/listicle",
                    "title": "Top 10 carbon accounting standards tips",
                    "content": "Best tips and quick reasons to improve carbon accounting fast.",
                    "definitions": [],
                    "subTopics": [],
                    "informativeScore": 0.42,
                    "authorityScore": 0.45,
                    "searchProvider": "google",
                },
                {
                    "url": "https://example.com/guide",
                    "title": "Carbon Accounting Standards Overview",
                    "content": (
                        "Carbon accounting standards are frameworks used to define, measure, and report greenhouse gas "
                        "emissions consistently across organizations. This overview describes scope boundaries, data "
                        "collection, verification, and reporting methods for enterprise use."
                    ),
                    "definitions": [
                        {
                            "term": "Carbon Accounting Standards",
                            "description": "Frameworks for consistent emissions measurement and reporting.",
                            "sourceUrl": "https://example.com/guide",
                        }
                    ],
                    "subTopics": [
                        {
                            "title": "Reporting Boundaries",
                            "summary": "How organizations define scopes and reporting units.",
                            "sourceUrl": "https://example.com/guide",
                        }
                    ],
                    "informativeScore": 0.86,
                    "authorityScore": 0.74,
                    "searchProvider": "manual",
                },
            ],
            query,
            query_words=query_words,
            expand_query_focus_words=expand_query_focus_words,
            tokenize=tokenize,
            normalize_space=normalize_space,
            source_relevance=source_relevance,
        )

        self.assertEqual("https://example.com/guide", ranked[0]["url"])

    def test_frontier_ranking_prefers_trusted_reference_when_content_quality_is_similar(self):
        query = "grid resilience planning"
        ranked = rank_frontier_results(
            [
                {
                    "url": "https://low-value.example.com/grid",
                    "title": "Grid resilience planning overview",
                    "content": (
                        "Grid resilience planning is an overview of electric reliability, emergency response, and "
                        "infrastructure hardening across utility systems."
                    ),
                    "definitions": [
                        {
                            "term": "Grid Resilience Planning",
                            "description": "Planning for electric system continuity under disruption.",
                            "sourceUrl": "https://low-value.example.com/grid",
                        }
                    ],
                    "subTopics": [],
                    "informativeScore": 0.78,
                    "authorityScore": 0.48,
                    "searchProvider": "google",
                },
                {
                    "url": "https://energy.edu/reference",
                    "title": "Grid resilience planning overview",
                    "content": (
                        "Grid resilience planning is an overview of electric reliability, emergency response, and "
                        "infrastructure hardening across utility systems."
                    ),
                    "definitions": [
                        {
                            "term": "Grid Resilience Planning",
                            "description": "Planning for electric system continuity under disruption.",
                            "sourceUrl": "https://energy.edu/reference",
                        }
                    ],
                    "subTopics": [],
                    "informativeScore": 0.78,
                    "authorityScore": 0.86,
                    "searchProvider": "manual",
                },
            ],
            query,
            query_words=query_words,
            expand_query_focus_words=expand_query_focus_words,
            tokenize=tokenize,
            normalize_space=normalize_space,
            source_relevance=source_relevance,
        )

        self.assertEqual("https://energy.edu/reference", ranked[0]["url"])


class SearchSnippetEnrichmentTests(unittest.TestCase):
    def test_sanitize_search_snippet_dedupes_repeated_serp_sentences(self):
        snippet = (
            "Grid resilience planning helps utilities prioritize restoration work after severe outages. "
            "Grid resilience planning helps utilities prioritize restoration work after severe outages. "
            "Utilities also use resilience planning to align hardening investments with outage risk."
        )

        cleaned = sanitize_search_snippet(snippet)

        self.assertEqual(1, cleaned.lower().count("prioritize restoration work"))
        self.assertIn("hardening investments", cleaned.lower())

    def test_enrich_frontier_results_merges_direct_page_excerpt(self):
        query = "grid resilience planning"
        results = [
            {
                "url": "https://example.com/grid-guide",
                "title": "Grid resilience planning guide",
                "content": "Grid resilience planning overview for utilities and infrastructure teams.",
                "definitions": [],
                "subTopics": [],
                "informativeScore": 0.56,
                "authorityScore": 0.62,
                "searchProvider": "google",
                "searchProviders": ["google"],
            }
        ]

        enriched = enrich_frontier_results(
            results,
            query,
            headers={"User-Agent": "test-agent"},
            fetch_page_document_fn=lambda url, headers, max_chars=2200: {
                "title": "Grid resilience planning guide",
                "content": (
                    "Grid resilience planning is a structured approach to reliability, restoration, hardening, mutual aid, "
                    "and scenario analysis across electric utility systems. Utilities use it to prioritize assets, establish "
                    "recovery playbooks, and align investment with outage risk."
                ),
            },
            query_words=query_words,
            expand_query_focus_words=expand_query_focus_words,
            tokenize=tokenize,
            normalize_space=normalize_space,
            source_relevance=source_relevance,
            debug=lambda message: None,
            limit=3,
        )

        self.assertEqual(1, len(enriched))
        self.assertIn("scenario analysis", enriched[0]["content"].lower())
        self.assertIn("page-fetch", enriched[0]["searchProviders"])

if __name__ == "__main__":
    unittest.main()
