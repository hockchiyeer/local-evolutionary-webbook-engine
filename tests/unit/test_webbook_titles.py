import random
import unittest

from engine.archetypes import infer_query_archetype
from evolution_engine import STOP_WORDS, generate_webbook, normalize_space, tokenize


LONG_QUERY = (
    "What is the most probable AI landscape over the next decade (2026-2036), "
    "considering investment flows, technological development trajectories, and "
    "high-value application domains, and how should enterprises and policymakers "
    "prioritize strategic bets, capability building, and risk mitigation in response?"
)
MALAYSIA_QUERY = "outlook for the malaysian stock market over the next one year"
COMPANY_QUERY = "NVIDIA business outlook 2026"
MOUNT_EVEREST_QUERY = "Mount Everest"
ARTEMIS_QUERY = "Artemis moon space journey"
MEDIA_QUERY = "Malaysiakini VS Merdakareview independent journalism in Malaysia during 2008 political tsunami watershed"


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


def build_mount_population():
    return [
        {
            "title": "Mount Everest",
            "url": "https://example.com/everest",
            "content": (
                "Mount Everest is Earth's highest mountain above sea level and sits on the border between Nepal and Tibet. "
                "Its summit, glaciers, seasonal weather, and high-altitude routes shape both the geography and the climbing risk profile."
            ),
            "definitions": [
                {
                    "term": "Summit elevation",
                    "description": "Mount Everest reaches 8,848.86 meters above sea level.",
                    "sourceUrl": "https://example.com/everest",
                }
            ],
            "subTopics": [
                {
                    "title": "Khumbu Icefall",
                    "summary": "A dangerous glacier section on the Nepal approach route.",
                    "sourceUrl": "https://example.com/everest",
                }
            ],
            "informativeScore": 0.92,
            "authorityScore": 0.88,
        },
        {
            "title": "Geography of Mount Everest",
            "url": "https://example.com/everest-geo",
            "content": (
                "The Everest massif influences glaciers, border geography, expedition staging, and seasonal summit windows. "
                "The mountain's terrain, elevation, and weather patterns determine how climbers move through the South Col and North Col routes."
            ),
            "definitions": [
                {
                    "term": "South Col",
                    "description": "High camp area on the southeast approach to Everest.",
                    "sourceUrl": "https://example.com/everest-geo",
                }
            ],
            "subTopics": [
                {
                    "title": "North Col route",
                    "summary": "The Tibetan approach to Everest's upper mountain.",
                    "sourceUrl": "https://example.com/everest-geo",
                }
            ],
            "informativeScore": 0.87,
            "authorityScore": 0.81,
        },
    ]


def build_artemis_population():
    return [
        {
            "title": "Artemis program",
            "url": "https://example.com/artemis-program",
            "content": (
                "Published in Journey to the Moon. Work type: book chapter. The Artemis program is NASA's lunar exploration "
                "program built around Orion, the Space Launch System, and long-horizon cislunar infrastructure. Artemis links "
                "crewed lunar missions, deep-space operations, science goals, and mission architecture planning."
            ),
            "definitions": [
                {
                    "term": "Mission architecture",
                    "description": "The integrated design of vehicles, launch cadence, and lunar operations.",
                    "sourceUrl": "https://example.com/artemis-program",
                }
            ],
            "subTopics": [
                {
                    "title": "Space Launch System",
                    "summary": "Heavy-lift rocket supporting Artemis missions.",
                    "sourceUrl": "https://example.com/artemis-program",
                }
            ],
            "informativeScore": 0.91,
            "authorityScore": 0.86,
        },
        {
            "title": "Artemis II mission profile",
            "url": "https://example.com/artemis-ii",
            "content": (
                "Subjects include lunar flyby planning, crew systems verification, and Orion readiness. Artemis II is the "
                "first crewed Artemis mission and tests navigation, spacecraft systems, and deep-space operations before later "
                "surface missions."
            ),
            "definitions": [
                {
                    "term": "Artemis II",
                    "description": "The first crewed mission in NASA's Artemis campaign.",
                    "sourceUrl": "https://example.com/artemis-ii",
                }
            ],
            "subTopics": [
                {
                    "title": "Lunar flyby",
                    "summary": "A crewed trajectory around the Moon before return to Earth.",
                    "sourceUrl": "https://example.com/artemis-ii",
                }
            ],
            "informativeScore": 0.89,
            "authorityScore": 0.84,
        },
    ]


def build_media_population():
    return [
        {
            "title": "Malaysiakini and Merdeka Review in Malaysia's independent media landscape",
            "url": "https://example.com/media",
            "content": (
                "Malaysiakini and Merdeka Review were independent media outlets whose journalism, editorial decisions, "
                "and newsroom positioning shaped online reporting during Malaysia's 2008 political watershed. Their reporting "
                "models influenced public debate, press freedom arguments, and the structure of digital news competition."
            ),
            "definitions": [
                {
                    "term": "Independent media outlet",
                    "description": "A newsroom operating outside direct state or party control.",
                    "sourceUrl": "https://example.com/media",
                }
            ],
            "subTopics": [
                {
                    "title": "Editorial positioning",
                    "summary": "How each outlet framed its journalism and audience strategy.",
                    "sourceUrl": "https://example.com/media",
                }
            ],
            "informativeScore": 0.86,
            "authorityScore": 0.82,
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

    def test_archetype_inference_handles_place_space_and_media_queries(self):
        self.assertEqual(
            "place",
            infer_query_archetype(
                MOUNT_EVEREST_QUERY,
                build_mount_population(),
                tokenize=tokenize,
                stop_words=STOP_WORDS,
                normalize_space=normalize_space,
            ),
        )
        self.assertEqual(
            "technology",
            infer_query_archetype(
                ARTEMIS_QUERY,
                build_artemis_population(),
                tokenize=tokenize,
                stop_words=STOP_WORDS,
                normalize_space=normalize_space,
            ),
        )
        self.assertEqual(
            "organization",
            infer_query_archetype(
                MEDIA_QUERY,
                build_media_population(),
                tokenize=tokenize,
                stop_words=STOP_WORDS,
                normalize_space=normalize_space,
            ),
        )

    def test_place_queries_use_place_chapter_path(self):
        random.seed(7)
        book = generate_webbook(build_mount_population(), MOUNT_EVEREST_QUERY)
        combined_titles = " ".join(chapter["title"] for chapter in book["chapters"][:6]).lower()

        self.assertEqual("place", book.get("topicArea"))
        self.assertTrue(
            any(term in combined_titles for term in ("geographic context", "historical formation", "development challenges"))
        )
        self.assertNotIn("background and identity", combined_titles)

    def test_space_program_titles_and_content_stay_high_signal(self):
        random.seed(11)
        book = generate_webbook(build_artemis_population(), ARTEMIS_QUERY)
        combined_titles = " ".join(chapter["title"] for chapter in book["chapters"][:6]).lower()
        combined_content = " ".join(chapter["content"] for chapter in book["chapters"][:4]).lower()

        self.assertEqual("technology", book.get("topicArea"))
        self.assertTrue(
            any(term in combined_titles for term in ("capital and compute", "infrastructure stack", "future trajectories", "mission architecture", "lunar flyby", "space launch system"))
        )
        for chapter in book["chapters"][:6]:
            chapter_tail = chapter["title"].split(":")[-1].strip().lower()
            self.assertNotIn(chapter_tail, {"ii", "program", "epic"})
        self.assertNotIn("published in", combined_content)
        self.assertNotIn("work type:", combined_content)
        self.assertNotIn("subjects include", combined_content)


if __name__ == "__main__":
    unittest.main()
