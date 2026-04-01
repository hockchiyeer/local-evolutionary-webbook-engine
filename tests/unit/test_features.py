import unittest

from engine.features import build_source_feature_snapshot
from evolution_engine import (
    clamp,
    content_signature_tokens,
    expand_query_focus_words,
    extract_concept_keys,
    normalize_space,
    query_words,
    source_relevance,
    tokenize,
)


QUERY = "advanced reactor supply chains"


def build_snapshot(result):
    q_words = query_words(QUERY)
    focus_words = expand_query_focus_words(q_words)
    return build_source_feature_snapshot(
        result,
        q_words,
        focus_words,
        tokenize=tokenize,
        normalize_space=normalize_space,
        source_relevance=source_relevance,
        extract_concept_keys=extract_concept_keys,
        content_signature_tokens=content_signature_tokens,
        clamp=clamp,
    )


class FeatureSnapshotTests(unittest.TestCase):
    def test_feature_snapshot_is_deterministic(self):
        result = {
            "url": "https://energy.edu/reactor",
            "title": "Advanced reactor supply chains overview",
            "content": (
                "Advanced reactor supply chains are industrial systems covering fuel, forgings, controls, "
                "manufacturing capacity, and component qualification for nuclear deployment."
            ),
            "definitions": [
                {
                    "term": "Advanced Reactor Supply Chains",
                    "description": "Industrial systems that support advanced nuclear deployment.",
                    "sourceUrl": "https://energy.edu/reactor",
                }
            ],
            "subTopics": [
                {
                    "title": "Manufacturing Capacity",
                    "summary": "The production base required for components and materials.",
                    "sourceUrl": "https://energy.edu/reactor",
                }
            ],
            "informativeScore": 0.84,
            "authorityScore": 0.88,
            "searchProvider": "manual",
        }

        first = build_snapshot(result)
        second = build_snapshot(result)

        self.assertEqual(first, second)

    def test_definitional_and_deeper_text_scores_higher_than_shallow_text(self):
        shallow = build_snapshot({
            "url": "https://example.com/tips",
            "title": "Top 10 reactor supply chain tips",
            "content": "Best tips for reactor supply chains fast.",
            "definitions": [],
            "subTopics": [],
            "informativeScore": 0.4,
            "authorityScore": 0.42,
        })
        deeper = build_snapshot({
            "url": "https://energy.edu/guide",
            "title": "Advanced reactor supply chains overview",
            "content": (
                "Advanced reactor supply chains are industrial systems that connect fuel preparation, forgings, "
                "quality assurance, controls, and specialized manufacturing. This overview describes bottlenecks, "
                "qualification workflows, and deployment dependencies."
            ),
            "definitions": [
                {
                    "term": "Supply Chain Qualification",
                    "description": "The process used to validate nuclear suppliers and components.",
                    "sourceUrl": "https://energy.edu/guide",
                }
            ],
            "subTopics": [
                {
                    "title": "Forgings and Components",
                    "summary": "How heavy manufacturing capacity constrains deployment.",
                    "sourceUrl": "https://energy.edu/guide",
                }
            ],
            "informativeScore": 0.87,
            "authorityScore": 0.86,
        })

        self.assertGreater(deeper["_definitional_density"], shallow["_definitional_density"])
        self.assertGreater(deeper["_content_depth"], shallow["_content_depth"])

    def test_spam_risk_penalizes_repetition_and_noise(self):
        noisy = build_snapshot({
            "url": "https://example.com/noisy",
            "title": "BUY NOW advanced reactor supply chains 999999999999",
            "content": (
                "buy now buy now buy now AAAAAAAAAA reactor1234567890 reactor1234567890 "
                "privacy policy subscribe subscribe subscribe"
            ),
            "definitions": [],
            "subTopics": [],
            "informativeScore": 0.22,
            "authorityScore": 0.3,
        })
        informative = build_snapshot({
            "url": "https://energy.gov/reactor",
            "title": "Advanced reactor supply chains overview",
            "content": (
                "Advanced reactor supply chains depend on fuel services, forgings, controls, quality systems, and "
                "specialized manufacturers. Reliable deployment requires supplier qualification and long lead-time planning."
            ),
            "definitions": [],
            "subTopics": [],
            "informativeScore": 0.8,
            "authorityScore": 0.85,
        })

        self.assertGreater(noisy["_spam_risk"], informative["_spam_risk"])

    def test_semantic_coherence_prefers_aligned_structure(self):
        coherent = build_snapshot({
            "url": "https://example.com/coherent",
            "title": "Grid resilience planning overview",
            "content": (
                "Grid resilience planning aligns emergency response, asset hardening, restoration priorities, and "
                "continuity metrics for utility systems."
            ),
            "definitions": [
                {
                    "term": "Grid Resilience Planning",
                    "description": "Planning for continuity, recovery, and infrastructure hardening.",
                    "sourceUrl": "https://example.com/coherent",
                }
            ],
            "subTopics": [
                {
                    "title": "Restoration Priorities",
                    "summary": "How utilities sequence recovery after disruption.",
                    "sourceUrl": "https://example.com/coherent",
                }
            ],
            "informativeScore": 0.84,
            "authorityScore": 0.82,
        })
        mismatched = build_snapshot({
            "url": "https://example.com/mismatch",
            "title": "Grid resilience planning overview",
            "content": (
                "Film distribution strategy includes theatrical release windows, streaming rights, celebrity marketing, "
                "and franchise positioning across entertainment platforms."
            ),
            "definitions": [
                {
                    "term": "Celebrity Marketing",
                    "description": "How entertainment brands use talent visibility to drive demand.",
                    "sourceUrl": "https://example.com/mismatch",
                }
            ],
            "subTopics": [
                {
                    "title": "Streaming Rights",
                    "summary": "Licensing arrangements for film and series distribution.",
                    "sourceUrl": "https://example.com/mismatch",
                }
            ],
            "informativeScore": 0.7,
            "authorityScore": 0.68,
        })

        self.assertGreater(coherent["_semantic_coherence"], mismatched["_semantic_coherence"])


if __name__ == "__main__":
    unittest.main()
