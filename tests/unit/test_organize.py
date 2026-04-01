import unittest

from engine.organize import build_source_clusters
from evolution_engine import (
    STOP_WORDS,
    expand_query_focus_words,
    generate_webbook,
    normalize_term_key,
    query_words,
    source_relevance,
    tokenize,
)


def build_population():
    return [
        {
            "title": "AI investment flows and frontier model economics",
            "url": "https://example.com/investment",
            "content": (
                "AI investment flows increasingly favor compute infrastructure, foundation-model labs, and cloud "
                "capacity. Capital concentration shapes which firms can sustain frontier training and deployment."
            ),
            "definitions": [
                {
                    "term": "Investment Flows",
                    "description": "How capital moves across AI labs, infrastructure, and applications.",
                    "sourceUrl": "https://example.com/investment",
                }
            ],
            "subTopics": [
                {
                    "title": "Model Economics",
                    "summary": "Commercial dynamics around training costs and monetization.",
                    "sourceUrl": "https://example.com/investment",
                }
            ],
            "informativeScore": 0.9,
            "authorityScore": 0.82,
        },
        {
            "title": "Enterprise AI workflow adoption and applications",
            "url": "https://example.com/adoption",
            "content": (
                "Enterprise adoption focuses on workflow redesign, tooling integration, and high-value application "
                "domains such as software engineering, analytics, and industrial automation."
            ),
            "definitions": [
                {
                    "term": "Workflow Adoption",
                    "description": "How organizations integrate AI into recurring operating processes.",
                    "sourceUrl": "https://example.com/adoption",
                }
            ],
            "subTopics": [
                {
                    "title": "Application Domains",
                    "summary": "Where AI creates measurable business value across sectors.",
                    "sourceUrl": "https://example.com/adoption",
                }
            ],
            "informativeScore": 0.9,
            "authorityScore": 0.8,
        },
        {
            "title": "AI governance, evaluation, and risk controls",
            "url": "https://example.com/governance",
            "content": (
                "Governance and risk mitigation require evaluation, monitoring, cybersecurity, and policy controls. "
                "Organizations need capability building to manage safety, compliance, and reliability."
            ),
            "definitions": [
                {
                    "term": "Risk Controls",
                    "description": "Operational and policy controls that reduce AI failure modes.",
                    "sourceUrl": "https://example.com/governance",
                }
            ],
            "subTopics": [
                {
                    "title": "Capability Building",
                    "summary": "Investments in talent, systems, and evaluation methods for responsible AI.",
                    "sourceUrl": "https://example.com/governance",
                }
            ],
            "informativeScore": 0.91,
            "authorityScore": 0.84,
        },
        {
            "title": "Public policy and competition strategy for AI",
            "url": "https://example.com/policy",
            "content": (
                "Policymakers weigh industrial strategy, market concentration, energy access, and cross-border "
                "competition when framing the long-run AI landscape."
            ),
            "definitions": [
                {
                    "term": "Industrial Strategy",
                    "description": "How public institutions shape AI competitiveness and infrastructure capacity.",
                    "sourceUrl": "https://example.com/policy",
                }
            ],
            "subTopics": [
                {
                    "title": "Competition Policy",
                    "summary": "How markets and regulation influence AI platform power.",
                    "sourceUrl": "https://example.com/policy",
                }
            ],
            "informativeScore": 0.88,
            "authorityScore": 0.83,
        },
    ]


def average_pairwise_source_overlap(source_groups):
    normalized_groups = [set(group) for group in source_groups if group]
    if len(normalized_groups) < 2:
        return 0.0

    overlaps = []
    for index, group in enumerate(normalized_groups):
        for other in normalized_groups[index + 1:]:
            union = group.union(other)
            overlaps.append((len(group.intersection(other)) / len(union)) if union else 0.0)
    return sum(overlaps) / len(overlaps)


class ClusterOrganizationTests(unittest.TestCase):
    def test_build_source_clusters_separates_distinct_facets(self):
        query = "AI investment, enterprise adoption, and governance strategy"
        clusters = build_source_clusters(
            build_population(),
            query,
            tokenize=tokenize,
            query_words=query_words,
            expand_query_focus_words=expand_query_focus_words,
            normalize_term_key=normalize_term_key,
            stop_words=STOP_WORDS,
            source_relevance=source_relevance,
        )

        self.assertGreaterEqual(len(clusters), 2)
        labels = " ".join(cluster["label"] for cluster in clusters).lower()
        self.assertTrue(any(keyword in labels for keyword in ("investment", "adoption", "governance", "policy")))

    def test_generate_webbook_spreads_primary_sources_across_chapters(self):
        query = (
            "What is the most probable AI landscape over the next decade (2026-2036), considering investment flows, "
            "enterprise adoption, governance, and policy strategy?"
        )
        book = generate_webbook(build_population(), query)

        self.assertTrue(book["chapters"])
        leading_source_urls = {
            chapter["sourceUrls"][0]["url"]
            for chapter in book["chapters"][:6]
            if chapter.get("sourceUrls")
        }
        self.assertGreaterEqual(len(leading_source_urls), 2)

    def test_clustered_assembly_has_lower_duplicate_source_overlap_than_naive_baseline(self):
        query = (
            "What is the most probable AI landscape over the next decade (2026-2036), considering investment flows, "
            "enterprise adoption, governance, and policy strategy?"
        )
        population = build_population()
        book = generate_webbook(population, query)

        clustered_groups = [
            {source["url"] for source in chapter.get("sourceUrls", []) if source.get("url")}
            for chapter in book["chapters"]
        ]
        naive_baseline_groups = [
            {source["url"] for source in population[:3]}
            for _ in book["chapters"]
        ]

        self.assertLess(
            average_pairwise_source_overlap(clustered_groups),
            average_pairwise_source_overlap(naive_baseline_groups),
        )


if __name__ == "__main__":
    unittest.main()
