import unittest

from evolution_engine import generate_webbook


LONG_QUERY = (
    "What is the most probable AI landscape over the next decade (2026-2036), "
    "considering investment flows, technological development trajectories, and "
    "high-value application domains, and how should enterprises and policymakers "
    "prioritize strategic bets, capability building, and risk mitigation in response?"
)


def build_population():
    return [
        {
            "title": "AI investment flows and frontier model economics",
            "url": "https://example.com/investment",
            "content": (
                "Investment flows in AI increasingly favor compute-intensive frontier models, cloud infrastructure, "
                "and enterprise products with measurable productivity gains."
            ),
            "definitions": [
                {
                    "term": "Investment Flows",
                    "description": "How capital is distributed across AI infrastructure, labs, and applications.",
                    "sourceUrl": "https://example.com/investment",
                }
            ],
            "subTopics": [
                {
                    "title": "Frontier Model Economics",
                    "summary": "Commercial dynamics around large model development and deployment.",
                    "sourceUrl": "https://example.com/investment",
                }
            ],
            "informativeScore": 0.9,
            "authorityScore": 0.84,
        },
        {
            "title": "Enterprise AI applications and workflow adoption",
            "url": "https://example.com/adoption",
            "content": (
                "High-value AI application domains include software engineering, industrial automation, knowledge "
                "work assistance, and scientific discovery."
            ),
            "definitions": [
                {
                    "term": "Application Domains",
                    "description": "Operational environments where AI can generate significant value.",
                    "sourceUrl": "https://example.com/adoption",
                }
            ],
            "subTopics": [
                {
                    "title": "Workflow Adoption",
                    "summary": "How organizations integrate AI into processes with measurable outcomes.",
                    "sourceUrl": "https://example.com/adoption",
                }
            ],
            "informativeScore": 0.91,
            "authorityScore": 0.8,
        },
        {
            "title": "AI governance, resilience, and risk controls",
            "url": "https://example.com/governance",
            "content": (
                "Capability building for AI requires governance, evaluation, cybersecurity, procurement discipline, "
                "and operational resilience in both enterprise and public-sector deployments."
            ),
            "definitions": [
                {
                    "term": "Capability Building",
                    "description": "Investment in talent, systems, and controls required for effective AI use.",
                    "sourceUrl": "https://example.com/governance",
                }
            ],
            "subTopics": [
                {
                    "title": "Risk Controls",
                    "summary": "Mitigation mechanisms for safety, legal, and operational AI failures.",
                    "sourceUrl": "https://example.com/governance",
                }
            ],
            "informativeScore": 0.89,
            "authorityScore": 0.85,
        },
    ]


class WebBookTitleTests(unittest.TestCase):
    def test_long_query_is_not_repeated_verbatim_in_each_chapter_title(self):
        book = generate_webbook(build_population(), LONG_QUERY)
        self.assertTrue(book["chapters"])

        for chapter in book["chapters"]:
            title = chapter["title"].lower()
            self.assertNotIn(LONG_QUERY.lower(), title)
            self.assertNotIn("what is the most probable", title)

    def test_titles_stay_concise_and_distinct(self):
        book = generate_webbook(build_population(), LONG_QUERY)
        titles = [chapter["title"] for chapter in book["chapters"]]

        self.assertEqual(len(titles), len(set(titles)))
        for title in titles:
            self.assertLess(len(title), 110)

    def test_titles_surface_topic_keywords_instead_of_prompt_scaffolding(self):
        book = generate_webbook(build_population(), LONG_QUERY)
        combined_titles = " ".join(chapter["title"] for chapter in book["chapters"]).lower()

        self.assertIn("ai", combined_titles)
        self.assertTrue(
            any(keyword in combined_titles for keyword in ("investment", "applications", "risk", "strategy", "governance"))
        )


if __name__ == "__main__":
    unittest.main()
