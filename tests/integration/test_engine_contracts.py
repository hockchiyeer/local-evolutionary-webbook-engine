import json
import subprocess
import sys
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
ENGINE_PATH = REPO_ROOT / "evolution_engine.py"


class EngineContractTests(unittest.TestCase):
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

    def _population(self):
        return [
            {
                "url": "https://example.com/ai-landscape",
                "title": "AI landscape overview",
                "content": (
                    "Artificial intelligence landscape analysis covers models, infrastructure, deployment, "
                    "governance, and capital allocation across major sectors."
                ),
                "definitions": [
                    {
                        "term": "AI Landscape",
                        "description": "The evolving ecosystem of AI models, firms, infrastructure, and applications.",
                        "sourceUrl": "https://example.com/ai-landscape",
                    }
                ],
                "subTopics": [
                    {
                        "title": "Infrastructure Strategy",
                        "summary": "How compute, data, and platform decisions shape AI competitiveness.",
                        "sourceUrl": "https://example.com/ai-landscape",
                    }
                ],
                "informativeScore": 0.88,
                "authorityScore": 0.82,
                "searchProvider": "manual",
                "searchProviders": ["manual"],
            },
            {
                "url": "https://example.com/ai-risk",
                "title": "AI risk and governance",
                "content": (
                    "Risk mitigation for AI includes evaluations, monitoring, incident response, and procurement "
                    "controls for high-impact use cases."
                ),
                "definitions": [
                    {
                        "term": "AI Governance",
                        "description": "Policies and controls for responsible AI deployment and oversight.",
                        "sourceUrl": "https://example.com/ai-risk",
                    }
                ],
                "subTopics": [
                    {
                        "title": "Risk Controls",
                        "summary": "Operational and policy interventions that reduce AI failure modes.",
                        "sourceUrl": "https://example.com/ai-risk",
                    }
                ],
                "informativeScore": 0.86,
                "authorityScore": 0.8,
                "searchProvider": "manual",
                "searchProviders": ["manual"],
            },
        ]

    def test_search_contract_uses_local_fallback_when_sources_are_disabled(self):
        payload = {
            "sources": {
                "wikipedia": False,
                "duckduckgo": False,
                "google": False,
                "bing": False,
            },
            "manualUrls": [],
            "disableMockFallback": False,
        }
        results = self._invoke_engine("search", "future of AI compute markets", payload)
        self.assertIsInstance(results, list)
        self.assertTrue(results)
        for result in results[:3]:
            for key in ("url", "title", "content", "definitions", "subTopics", "informativeScore", "authorityScore"):
                self.assertIn(key, result)

    def test_evolve_contract_returns_ranked_sources(self):
        evolved = self._invoke_engine("evolve", "AI strategy", self._population())
        self.assertIsInstance(evolved, list)
        self.assertTrue(evolved)
        for item in evolved:
            for key in ("url", "title", "content", "definitions", "subTopics", "fitness"):
                self.assertIn(key, item)

    def test_assemble_contract_returns_webbook_shape(self):
        webbook = self._invoke_engine("assemble", "AI strategy", self._population())
        self.assertIn("topic", webbook)
        self.assertIn("chapters", webbook)
        self.assertIn("id", webbook)
        self.assertIn("timestamp", webbook)
        self.assertTrue(webbook["chapters"])

        for chapter in webbook["chapters"][:2]:
            for key in ("title", "content", "definitions", "subTopics", "sourceUrls", "visualSeed"):
                self.assertIn(key, chapter)


if __name__ == "__main__":
    unittest.main()
