import unittest

from evolution_engine import generate_webbook


LONG_QUERY = (
    "What is the most probable AI landscape over the next decade (2026-2036), "
    "considering investment flows, technological development trajectories, and "
    "high-value application domains, and how should enterprises and policymakers "
    "prioritize strategic bets, capability building, and risk mitigation in response?"
)
MALAYSIA_QUERY = "outlook for the malaysian stock market over the next one year"
COMPANY_QUERY = "NVIDIA business outlook 2026"


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


def build_market_population():
    return [
        {
            "title": "Bursa Malaysia outlook and sector rotation",
            "url": "https://example.com/bursa",
            "content": (
                "Bursa Malaysia performance depends on sector rotation, earnings revisions, and domestic liquidity "
                "conditions across banks, plantations, and technology exporters."
            ),
            "definitions": [
                {
                    "term": "Bursa Malaysia",
                    "description": "Malaysia's main exchange for listed equities and market disclosure.",
                    "sourceUrl": "https://example.com/bursa",
                }
            ],
            "subTopics": [
                {
                    "title": "Sector Rotation",
                    "summary": "How investors rebalance capital among Malaysian listed sectors.",
                    "sourceUrl": "https://example.com/bursa",
                }
            ],
            "informativeScore": 0.88,
            "authorityScore": 0.82,
        },
        {
            "title": "Foreign investment flows and Malaysia equities",
            "url": "https://example.com/flows",
            "content": (
                "Foreign inflows and currency stability influence valuation multiples, capital formation, and "
                "trading sentiment in Malaysia equities."
            ),
            "definitions": [
                {
                    "term": "Foreign Investment Flows",
                    "description": "Cross-border capital movements shaping listed-company demand and pricing.",
                    "sourceUrl": "https://example.com/flows",
                }
            ],
            "subTopics": [
                {
                    "title": "Currency Stability",
                    "summary": "How exchange-rate pressure affects foreign participation and valuation risk.",
                    "sourceUrl": "https://example.com/flows",
                }
            ],
            "informativeScore": 0.86,
            "authorityScore": 0.8,
        },
        {
            "title": "Commodity pricing and export-linked earnings",
            "url": "https://example.com/commodities",
            "content": (
                "Commodity prices affect plantation producers, energy exporters, and industrial earnings that feed "
                "into Malaysian equity-market expectations."
            ),
            "definitions": [
                {
                    "term": "Commodity Pricing",
                    "description": "Market prices for energy, metals, and agricultural exports relevant to equities.",
                    "sourceUrl": "https://example.com/commodities",
                }
            ],
            "subTopics": [
                {
                    "title": "Export Earnings",
                    "summary": "Profit sensitivity of listed firms to global demand and commodity cycles.",
                    "sourceUrl": "https://example.com/commodities",
                }
            ],
            "informativeScore": 0.85,
            "authorityScore": 0.78,
        },
        {
            "title": "Capital-market regulation and disclosure standards",
            "url": "https://example.com/regulation",
            "content": (
                "Capital-market regulation, disclosure standards, and governance reforms influence investor "
                "confidence, compliance costs, and listing quality in Malaysia."
            ),
            "definitions": [
                {
                    "term": "Capital-Market Regulation",
                    "description": "Rules and governance standards that shape market access and transparency.",
                    "sourceUrl": "https://example.com/regulation",
                }
            ],
            "subTopics": [
                {
                    "title": "Disclosure Standards",
                    "summary": "Reporting requirements that affect trust and valuation discipline.",
                    "sourceUrl": "https://example.com/regulation",
                }
            ],
            "informativeScore": 0.84,
            "authorityScore": 0.81,
        },
    ]


def build_company_population():
    return [
        {
            "title": "NVIDIA data center revenue and AI infrastructure strategy",
            "url": "https://example.com/nvda-strategy",
            "content": (
                "NVIDIA builds its growth around GPU platforms, AI infrastructure, software ecosystems, and data-center "
                "partnerships. Revenue concentration, product cadence, and hyperscaler demand shape the company outlook."
            ),
            "definitions": [
                {
                    "term": "GPU Platform",
                    "description": "Integrated hardware and software stack for accelerated computing.",
                    "sourceUrl": "https://example.com/nvda-strategy",
                }
            ],
            "subTopics": [
                {
                    "title": "Hyperscaler Demand",
                    "summary": "Cloud-provider demand is a major driver of product mix and revenue growth.",
                    "sourceUrl": "https://example.com/nvda-strategy",
                }
            ],
            "informativeScore": 0.9,
            "authorityScore": 0.82,
        },
        {
            "title": "NVIDIA competitive position in AI chips",
            "url": "https://example.com/nvda-competition",
            "content": (
                "Competitive pressure from AMD, custom silicon, and cloud vendors affects NVIDIA margins, supply-chain "
                "planning, and product differentiation."
            ),
            "definitions": [
                {
                    "term": "Competitive Position",
                    "description": "Relative strength versus rivals in price, performance, and ecosystem control.",
                    "sourceUrl": "https://example.com/nvda-competition",
                }
            ],
            "subTopics": [
                {
                    "title": "Custom Silicon",
                    "summary": "Hyperscalers are developing in-house accelerators that may alter purchasing patterns.",
                    "sourceUrl": "https://example.com/nvda-competition",
                }
            ],
            "informativeScore": 0.87,
            "authorityScore": 0.79,
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

        self.assertEqual("technology", book.get("topicArea"))
        self.assertIn("ai", combined_titles)
        self.assertTrue(
            any(keyword in combined_titles for keyword in ("investment", "applications", "risk", "strategy", "governance"))
        )

    def test_market_titles_expand_beyond_repeating_stock_market_phrase(self):
        book = generate_webbook(build_market_population(), MALAYSIA_QUERY)
        titles = [chapter["title"].lower() for chapter in book["chapters"]]
        repeated_phrase_count = sum("stock market" in title for title in titles)
        combined_titles = " ".join(titles)

        self.assertEqual("market", book.get("topicArea"))
        self.assertLessEqual(repeated_phrase_count, 4)
        self.assertTrue(
            any(term in combined_titles for term in ("bursa", "foreign", "commodity", "regulation", "capital"))
        )
        self.assertTrue(
            any(term in combined_titles for term in ("market foundations", "capital flows and liquidity", "policy and regulation", "forward outlook"))
        )

    def test_company_queries_use_organization_chapter_path(self):
        book = generate_webbook(build_company_population(), COMPANY_QUERY)
        combined_titles = " ".join(chapter["title"] for chapter in book["chapters"][:6]).lower()

        self.assertEqual("organization", book.get("topicArea"))
        self.assertTrue(
            any(term in combined_titles for term in ("operating model", "market position", "economics and performance", "strategy and execution"))
        )
        self.assertNotIn("historical development", combined_titles)


if __name__ == "__main__":
    unittest.main()
