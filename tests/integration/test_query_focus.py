import unittest

from evolution_engine import (
    calculate_fitness_breakdown,
    evolve,
    generate_webbook,
    get_fallback_query,
    query_words,
    source_relevance,
)


QUERY = "outlook for the malaysian stock market over the next one year"
LONG_AI_QUERY = (
    "What is the most probable AI landscape over the next decade (2026-2036), "
    "considering investment flows, technological development trajectories, and "
    "high-value application domains, and how should enterprises and policymakers "
    "prioritize strategic bets, capability building, and risk mitigation in response?"
)
THOMAS_CUP_QUERY = "Which team will win Thomas Cup 2026"
US_WORLD_CUP_QUERY = "Which team will win US World Cup 2026"


class QueryFocusTests(unittest.TestCase):
    def setUp(self):
        self.population = [
            {
                "title": "Stock market outlook remains uneven",
                "url": "https://example.com/global-outlook",
                "content": (
                    "Global stock markets may post uneven returns next year as inflation and rate cuts "
                    "shape sector performance. Investors are watching US technology leadership, "
                    "European industrial weakness, and China demand trends."
                ),
                "informativeScore": 0.7,
                "authorityScore": 0.7,
            },
            {
                "title": "Malaysia economy and equities face mixed year",
                "url": "https://example.com/malaysia",
                "content": (
                    "Malaysia's economy is expected to expand moderately, with domestic demand, public "
                    "investment, and electronics exports influencing listed companies. Bursa Malaysia "
                    "performance will depend on earnings revisions, sector rotation, and currency stability."
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

    def test_malaysia_market_query_uses_focused_fallback_terms(self):
        fallback_query = get_fallback_query(QUERY).lower()
        self.assertTrue("malaysian" in fallback_query or "malaysia" in fallback_query)
        self.assertTrue("stock" in fallback_query or "market" in fallback_query)
        self.assertIn("outlook", fallback_query)

    def test_evolution_prioritizes_malaysia_specific_source(self):
        evolved = evolve(self.population, QUERY)
        self.assertTrue(evolved)
        lead_title = evolved[0]["title"].lower()
        self.assertTrue("malaysia" in lead_title or "bursa" in lead_title)

    def test_generated_webbook_retains_malaysia_context(self):
        book = generate_webbook(self.population, QUERY)
        self.assertTrue(book["chapters"])

        first_chapter = book["chapters"][0]
        combined_text = f"{first_chapter['title']} {first_chapter['content']}".lower()
        self.assertTrue("malaysia" in combined_text or "bursa" in combined_text)

    def test_fitness_breakdown_exposes_expected_components(self):
        breakdown = calculate_fitness_breakdown([0, 1], self.population, QUERY)
        for key in (
            "relevance",
            "informative",
            "authority",
            "coverage",
            "concept_diversity",
            "pairwise_diversity",
            "structure_score",
            "total",
        ):
            self.assertIn(key, breakdown)

    def test_long_query_chapter_titles_do_not_repeat_full_prompt(self):
        ai_population = [
            {
                "title": "AI investment flows and capital concentration",
                "url": "https://example.com/ai-investment",
                "content": (
                    "AI investment flows are increasingly concentrated in frontier model labs, cloud infrastructure, "
                    "and applied enterprise software. Venture capital and sovereign capital also shape regional "
                    "competition, compute access, and commercialization strategies."
                ),
                "definitions": [
                    {
                        "term": "AI Investment Flows",
                        "description": "Capital allocation patterns across model labs, infrastructure, and applications.",
                        "sourceUrl": "https://example.com/ai-investment",
                    }
                ],
                "subTopics": [
                    {
                        "title": "Capital Allocation",
                        "summary": "How AI funding moves across infrastructure, models, and enterprise products.",
                        "sourceUrl": "https://example.com/ai-investment",
                    }
                ],
                "informativeScore": 0.88,
                "authorityScore": 0.82,
            },
            {
                "title": "Enterprise AI adoption and high-value application domains",
                "url": "https://example.com/ai-applications",
                "content": (
                    "High-value application domains for AI include software engineering, drug discovery, industrial "
                    "automation, finance, and public-sector analytics. Enterprise adoption depends on workflow fit, "
                    "risk controls, and the availability of reliable evaluation."
                ),
                "definitions": [
                    {
                        "term": "Application Domains",
                        "description": "Business or policy areas where AI can create significant value.",
                        "sourceUrl": "https://example.com/ai-applications",
                    }
                ],
                "subTopics": [
                    {
                        "title": "Enterprise Adoption",
                        "summary": "Deployment patterns for AI inside large organizations and regulated sectors.",
                        "sourceUrl": "https://example.com/ai-applications",
                    }
                ],
                "informativeScore": 0.91,
                "authorityScore": 0.79,
            },
            {
                "title": "AI governance, risk mitigation, and capability building",
                "url": "https://example.com/ai-governance",
                "content": (
                    "AI governance requires capability building in model evaluation, data stewardship, cybersecurity, "
                    "and incident response. Policymakers and enterprises must balance innovation with safety, "
                    "competition, and resilience."
                ),
                "definitions": [
                    {
                        "term": "Capability Building",
                        "description": "Organizational investment in talent, infrastructure, and governance for AI.",
                        "sourceUrl": "https://example.com/ai-governance",
                    }
                ],
                "subTopics": [
                    {
                        "title": "Risk Mitigation",
                        "summary": "Controls that reduce safety, operational, legal, and security risk in AI systems.",
                        "sourceUrl": "https://example.com/ai-governance",
                    }
                ],
                "informativeScore": 0.9,
                "authorityScore": 0.84,
            },
        ]

        book = generate_webbook(ai_population, LONG_AI_QUERY)
        self.assertTrue(book["chapters"])
        titles = [chapter["title"].lower() for chapter in book["chapters"]]

        for title in titles:
            self.assertNotIn(LONG_AI_QUERY.lower(), title)
            self.assertNotIn("what is the most probable", title)
            self.assertLess(len(title), 110)

    def test_thomas_cup_query_disambiguates_toward_badminton(self):
        fallback_query = get_fallback_query(THOMAS_CUP_QUERY).lower()
        self.assertIn("thomas", fallback_query)
        self.assertTrue("badminton" in fallback_query or "bwf" in fallback_query)

        badminton_result = {
            "title": "Thomas Cup 2026 badminton contenders and BWF team form",
            "url": "https://example.com/thomas-cup",
            "content": (
                "Thomas Cup 2026 is the men's world team badminton championship, and contender analysis centers "
                "on squad depth, doubles strength, and BWF tournament form."
            ),
            "informativeScore": 0.84,
            "authorityScore": 0.78,
        }
        football_result = {
            "title": "2026 FIFA World Cup host format",
            "url": "https://example.com/fifa",
            "content": "The 2026 FIFA World Cup is a men's soccer tournament hosted by the United States, Mexico, and Canada.",
            "informativeScore": 0.82,
            "authorityScore": 0.82,
        }

        q_words = query_words(THOMAS_CUP_QUERY)
        self.assertGreater(source_relevance(badminton_result, q_words), source_relevance(football_result, q_words))
        evolved = evolve([football_result, badminton_result], THOMAS_CUP_QUERY)
        self.assertTrue(evolved)
        self.assertTrue(any(term in evolved[0]["title"].lower() for term in ("thomas", "badminton", "bwf")))

    def test_us_world_cup_query_disambiguates_toward_fifa(self):
        fallback_query = get_fallback_query(US_WORLD_CUP_QUERY).lower()
        self.assertIn("world", fallback_query)
        self.assertTrue("fifa" in fallback_query or "soccer" in fallback_query)

        fifa_result = {
            "title": "2026 FIFA World Cup contender analysis",
            "url": "https://example.com/fifa-world-cup",
            "content": (
                "The 2026 FIFA World Cup is the men's soccer championship hosted by the United States, Mexico, and "
                "Canada, and contender analysis focuses on national-team depth and tournament pathways."
            ),
            "informativeScore": 0.86,
            "authorityScore": 0.84,
        }
        cricket_result = {
            "title": "2026 ICC Men's T20 World Cup final outlook",
            "url": "https://example.com/t20",
            "content": "The ICC Men's T20 World Cup is an international cricket tournament contested by national cricket teams.",
            "informativeScore": 0.84,
            "authorityScore": 0.8,
        }

        q_words = query_words(US_WORLD_CUP_QUERY)
        self.assertGreater(source_relevance(fifa_result, q_words), source_relevance(cricket_result, q_words))
        evolved = evolve([cricket_result, fifa_result], US_WORLD_CUP_QUERY)
        self.assertTrue(evolved)
        self.assertTrue(any(term in evolved[0]["title"].lower() for term in ("fifa", "soccer", "world cup")))


if __name__ == "__main__":
    unittest.main()
