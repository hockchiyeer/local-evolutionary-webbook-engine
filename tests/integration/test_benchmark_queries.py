import unittest

from engine.benchmarks import (
    BENCHMARK_CASE_SPECS,
    build_benchmark_packs,
    filter_benchmark_cases_by_tag,
    run_benchmark_case,
    run_benchmark_pack,
    run_benchmark_suite,
)


SUITE_BASELINES = {
    "average_relevance": 0.90,
    "focus_coverage": 0.68,
    "redundancy_max": 0.38,
    "chapter_distinctness": 0.33,
    "average_authority": 0.63,
}

MALAYSIA_BASELINES = {
    "average_relevance": 0.95,
    "focus_coverage": 0.95,
    "redundancy_max": 0.39,
    "chapter_distinctness": 0.30,
    "average_authority": 0.63,
}


class BenchmarkHarnessTests(unittest.TestCase):
    def test_benchmark_library_is_broad_and_extensible(self):
        packs = build_benchmark_packs()
        pack_names = {pack["pack_name"] for pack in packs}

        self.assertGreaterEqual(len(BENCHMARK_CASE_SPECS), 30)
        self.assertGreaterEqual(len(packs), 50)
        for required_pack in (
            "technical",
            "finance",
            "science",
            "policy",
            "history",
            "entertainment",
            "health",
            "energy",
            "education",
            "manufacturing",
            "environment",
            "cybersecurity",
            "logistics",
            "legal",
            "telecom",
            "aviation",
            "insurance",
            "government",
            "malaysia",
            "all",
        ):
            self.assertIn(required_pack, pack_names)

    def test_single_benchmark_case_emits_expected_metrics(self):
        run = run_benchmark_case(BENCHMARK_CASE_SPECS[0])

        self.assertGreater(run["population_size"], 0)
        self.assertGreater(run["evolved_size"], 0)
        self.assertGreater(run["chapter_count"], 0)
        for metric_name in (
            "average_relevance",
            "focus_coverage",
            "redundancy",
            "chapter_distinctness",
            "average_authority",
        ):
            self.assertIn(metric_name, run["metrics"])
            self.assertGreaterEqual(run["metrics"][metric_name], 0.0)
            self.assertLessEqual(run["metrics"][metric_name], 1.0)

    def test_suite_metrics_clear_regression_baselines(self):
        suite = run_benchmark_suite()
        summary = suite["summary"]
        distribution = summary["distribution"]

        self.assertGreaterEqual(summary["average_relevance"], SUITE_BASELINES["average_relevance"])
        self.assertGreaterEqual(summary["focus_coverage"], SUITE_BASELINES["focus_coverage"])
        self.assertLessEqual(summary["redundancy"], SUITE_BASELINES["redundancy_max"])
        self.assertGreaterEqual(summary["chapter_distinctness"], SUITE_BASELINES["chapter_distinctness"])
        self.assertGreaterEqual(summary["average_authority"], SUITE_BASELINES["average_authority"])
        self.assertGreaterEqual(distribution["average_relevance"]["median"], 0.93)
        self.assertGreaterEqual(distribution["focus_coverage"]["p25"], 0.58)
        self.assertLessEqual(distribution["redundancy"]["p75"], 0.38)
        self.assertGreaterEqual(distribution["chapter_distinctness"]["median"], 0.33)

    def test_malaysia_benchmark_does_not_regress(self):
        malaysia_cases = filter_benchmark_cases_by_tag("malaysia")
        malaysia_pack = run_benchmark_pack("malaysia", malaysia_cases)
        summary = malaysia_pack["summary"]

        self.assertEqual(1, summary["case_count"])
        self.assertGreaterEqual(summary["average_relevance"], MALAYSIA_BASELINES["average_relevance"])
        self.assertGreaterEqual(summary["focus_coverage"], MALAYSIA_BASELINES["focus_coverage"])
        self.assertLessEqual(summary["redundancy"], MALAYSIA_BASELINES["redundancy_max"])
        self.assertGreaterEqual(summary["chapter_distinctness"], MALAYSIA_BASELINES["chapter_distinctness"])
        self.assertGreaterEqual(summary["average_authority"], MALAYSIA_BASELINES["average_authority"])


if __name__ == "__main__":
    unittest.main()
