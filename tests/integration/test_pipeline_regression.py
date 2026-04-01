import json
import subprocess
import sys
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
ENGINE_PATH = REPO_ROOT / "evolution_engine.py"
MALAYSIA_QUERY = "outlook for the malaysian stock market over the next one year"
LONG_AI_QUERY = (
    "What is the most probable AI landscape over the next decade (2026-2036), "
    "considering investment flows, technological development trajectories, and "
    "high-value application domains, and how should enterprises and policymakers "
    "prioritize strategic bets, capability building, and risk mitigation in response?"
)
PERSON_QUERY = "Mahathir Mohammad"


def build_ai_population():
    return [
        {
            "url": "https://example.com/ai-investment",
            "title": "AI investment flows and frontier model economics",
            "content": (
                "Investment flows in AI increasingly favor frontier model labs, compute infrastructure, and "
                "enterprise products with measurable productivity gains."
            ),
            "definitions": [
                {
                    "term": "Investment Flows",
                    "description": "How capital is distributed across AI infrastructure, labs, and applications.",
                    "sourceUrl": "https://example.com/ai-investment",
                }
            ],
            "subTopics": [
                {
                    "title": "Frontier Model Economics",
                    "summary": "Commercial dynamics around large model development and deployment.",
                    "sourceUrl": "https://example.com/ai-investment",
                }
            ],
            "informativeScore": 0.9,
            "authorityScore": 0.84,
        },
        {
            "url": "https://example.com/ai-applications",
            "title": "Enterprise AI applications and workflow adoption",
            "content": (
                "High-value AI application domains include software engineering, industrial automation, knowledge "
                "work assistance, and scientific discovery."
            ),
            "definitions": [
                {
                    "term": "Application Domains",
                    "description": "Operational environments where AI can generate significant value.",
                    "sourceUrl": "https://example.com/ai-applications",
                }
            ],
            "subTopics": [
                {
                    "title": "Workflow Adoption",
                    "summary": "How organizations integrate AI into processes with measurable outcomes.",
                    "sourceUrl": "https://example.com/ai-applications",
                }
            ],
            "informativeScore": 0.91,
            "authorityScore": 0.8,
        },
        {
            "url": "https://example.com/ai-governance",
            "title": "AI governance, resilience, and risk controls",
            "content": (
                "Capability building for AI requires governance, evaluation, cybersecurity, procurement discipline, "
                "and operational resilience in both enterprise and public-sector deployments."
            ),
            "definitions": [
                {
                    "term": "Capability Building",
                    "description": "Investment in talent, systems, and controls required for effective AI use.",
                    "sourceUrl": "https://example.com/ai-governance",
                }
            ],
            "subTopics": [
                {
                    "title": "Risk Controls",
                    "summary": "Mitigation mechanisms for safety, legal, and operational AI failures.",
                    "sourceUrl": "https://example.com/ai-governance",
                }
            ],
            "informativeScore": 0.89,
            "authorityScore": 0.85,
        },
    ]


def build_malaysia_population():
    return [
        {
            "title": "Stock market outlook remains uneven",
            "url": "https://example.com/global-outlook",
            "content": (
                "Global stock markets may post uneven returns next year as inflation and rate cuts shape sector "
                "performance. Investors are watching US technology leadership and China demand trends."
            ),
            "informativeScore": 0.7,
            "authorityScore": 0.7,
        },
        {
            "title": "Malaysia economy and equities face mixed year",
            "url": "https://example.com/malaysia",
            "content": (
                "Malaysia's economy is expected to expand moderately, with domestic demand, public investment, and "
                "electronics exports influencing listed companies. Bursa Malaysia performance will depend on earnings "
                "revisions, sector rotation, and currency stability."
            ),
            "informativeScore": 0.8,
            "authorityScore": 0.8,
        },
        {
            "title": "London stocks mixed as FTSE reacts to rate expectations",
            "url": "https://example.com/london",
            "content": "London equities were mixed as investors weighed Bank of England signals and commodity movements.",
            "informativeScore": 0.5,
            "authorityScore": 0.6,
        },
    ]


class PipelineRegressionTests(unittest.TestCase):
    def _invoke_engine(self, mode, query, payload=None):
        process = subprocess.run(
            [sys.executable, str(ENGINE_PATH), mode, query],
            input=json.dumps(payload) if payload is not None else None,
            capture_output=True,
            text=True,
            cwd=REPO_ROOT,
            check=False,
        )
        self.assertEqual(
            process.returncode,
            0,
            msg=f"Engine exited with code {process.returncode}\nSTDERR:\n{process.stderr}",
        )
        self.assertTrue(process.stdout.strip(), msg=f"Expected JSON output.\nSTDERR:\n{process.stderr}")
        return json.loads(process.stdout)

    def test_search_contract_stays_compatible_under_fallback_only_search(self):
        results = self._invoke_engine(
            "search",
            "future of AI compute markets",
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

        self.assertIsInstance(results, list)
        self.assertTrue(results)
        for result in results[:3]:
            for key in ("url", "title", "content", "definitions", "subTopics", "informativeScore", "authorityScore"):
                self.assertIn(key, result)

    def test_evolve_output_fields_stay_stable_and_bounded(self):
        evolved = self._invoke_engine("evolve", LONG_AI_QUERY, build_ai_population())

        self.assertIsInstance(evolved, list)
        self.assertTrue(evolved)
        for item in evolved:
            for key in ("url", "title", "content", "definitions", "subTopics", "fitness"):
                self.assertIn(key, item)
            self.assertGreaterEqual(item["fitness"], 0.0)
            self.assertLessEqual(item["fitness"], 1.0)

    def test_assemble_schema_stays_stable_and_titles_remain_concise(self):
        webbook = self._invoke_engine("assemble", LONG_AI_QUERY, build_ai_population())

        self.assertIn("topic", webbook)
        self.assertIn("chapters", webbook)
        self.assertIn("id", webbook)
        self.assertIn("timestamp", webbook)
        self.assertTrue(webbook["chapters"])

        for chapter in webbook["chapters"]:
            for key in ("title", "content", "definitions", "subTopics", "sourceUrls", "visualSeed"):
                self.assertIn(key, chapter)
            title = chapter["title"].lower()
            self.assertNotIn(LONG_AI_QUERY.lower(), title)
            self.assertNotIn("what is the most probable", title)
            self.assertLess(len(chapter["title"]), 120)

    def test_malaysia_context_survives_end_to_end_assembly(self):
        webbook = self._invoke_engine("assemble", MALAYSIA_QUERY, build_malaysia_population())

        self.assertTrue(webbook["chapters"])
        first_chapter = webbook["chapters"][0]
        combined_text = f"{first_chapter['title']} {first_chapter['content']}".lower()
        self.assertTrue("malaysia" in combined_text or "bursa" in combined_text)

    def test_person_name_query_stays_person_relevant_under_fallback_only_search(self):
        results = self._invoke_engine(
            "search",
            PERSON_QUERY,
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
        webbook = self._invoke_engine("assemble", PERSON_QUERY, results)

        self.assertTrue(webbook["chapters"])
        combined_titles = " ".join(chapter["title"] for chapter in webbook["chapters"][:5]).lower()
        combined_content = " ".join(chapter["content"] for chapter in webbook["chapters"][:3]).lower()

        self.assertTrue(any(term in combined_titles for term in ("background", "career", "leadership", "legacy")))
        self.assertTrue(any(term in combined_content for term in ("public figure", "biographical", "career milestones", "leadership")))
        self.assertNotIn("applications and use cases", combined_titles)
        self.assertNotIn("challenges and constraints", combined_titles)


if __name__ == "__main__":
    unittest.main()
