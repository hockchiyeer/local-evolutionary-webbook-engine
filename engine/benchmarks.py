"""Deterministic benchmark harness for backend-only quality regression checks."""

from dataclasses import dataclass
import statistics
from typing import Any, Dict, List, Sequence

from engine.search import rank_frontier_results
from evolution_engine import (
    average,
    content_signature_tokens,
    expand_query_focus_words,
    generate_webbook,
    jaccard_similarity,
    normalize_space,
    query_words,
    source_relevance,
    tokenize,
    evolve,
)


@dataclass(frozen=True)
class BenchmarkCaseSpec:
    case_id: str
    query: str
    topic_label: str
    facets: Sequence[str]
    distractor_terms: Sequence[str]
    tags: Sequence[str]
    geography_terms: Sequence[str] = ()


BENCHMARK_CASE_SPECS: Sequence[BenchmarkCaseSpec] = (
    BenchmarkCaseSpec(
        "distributed-tracing",
        "distributed tracing for microservices at scale",
        "Distributed Tracing",
        ("Foundations", "Instrumentation", "Latency Analysis", "Sampling", "Operations", "Strategy"),
        ("podcast audience measurement", "influencer sponsorship", "festival ticketing"),
        ("technical", "software", "observability"),
    ),
    BenchmarkCaseSpec(
        "malaysia-stock-market",
        "outlook for the malaysian stock market over the next one year",
        "Malaysia Stock Market Outlook",
        ("Foundations", "Earnings Outlook", "Sector Rotation", "Liquidity", "Policy Signals", "Forward View"),
        ("London celebrity investing", "US meme stocks", "luxury brand sponsorship"),
        ("finance", "malaysia", "markets"),
        ("Malaysia", "Bursa Malaysia", "ringgit", "Kuala Lumpur"),
    ),
    BenchmarkCaseSpec(
        "cbdc-adoption",
        "central bank digital currency adoption risk and payment system design",
        "Central Bank Digital Currency Adoption",
        ("Foundations", "Payment Design", "Bank Disintermediation", "Regulation", "Inclusion", "Outlook"),
        ("crypto celebrity tokens", "gaming skins market", "fan loyalty rewards"),
        ("finance", "policy", "payments"),
    ),
    BenchmarkCaseSpec(
        "gene-editing-governance",
        "gene editing governance for clinical research",
        "Gene Editing Governance",
        ("Foundations", "Clinical Trials", "Ethics", "Regulatory Controls", "Risk Mitigation", "Evidence"),
        ("beauty influencer trends", "celebrity fashion licensing", "festival promotion"),
        ("science", "health", "policy"),
    ),
    BenchmarkCaseSpec(
        "industrial-ai-policy",
        "industrial AI policy and export controls",
        "Industrial AI Policy",
        ("Foundations", "Export Controls", "Industrial Strategy", "Supply Chains", "Risk Governance", "Outlook"),
        ("music chart rankings", "film awards campaigning", "brand endorsements"),
        ("policy", "technology", "geopolitics"),
    ),
    BenchmarkCaseSpec(
        "maritime-silk-road",
        "maritime silk road trade network expansion",
        "Maritime Silk Road Trade Network",
        ("Foundations", "Port Systems", "Commercial Routes", "State Power", "Comparisons", "Historical Outlook"),
        ("celebrity cruise reviews", "luxury travel promotions", "festival tourism packages"),
        ("history", "trade", "geopolitics"),
    ),
    BenchmarkCaseSpec(
        "esports-franchising",
        "economics of esports league franchising",
        "Esports League Franchising",
        ("Foundations", "Revenue Models", "Team Economics", "Media Rights", "Risk Factors", "Future Outlook"),
        ("movie soundtrack licensing", "fashion influencer strategy", "concert ticket upselling"),
        ("entertainment", "sports", "business"),
    ),
    BenchmarkCaseSpec(
        "hospital-staffing",
        "hospital staffing resilience during respiratory outbreaks",
        "Hospital Staffing Resilience",
        ("Foundations", "Workforce Planning", "Surge Capacity", "Operations", "Safety Controls", "Evidence"),
        ("wellness influencer branding", "celebrity skincare launches", "festival merchandise"),
        ("health", "operations", "policy"),
    ),
    BenchmarkCaseSpec(
        "grid-resilience",
        "grid resilience planning for coastal utilities",
        "Grid Resilience Planning",
        ("Foundations", "Asset Hardening", "Restoration", "Regulation", "Metrics", "Strategic Outlook"),
        ("fashion retail planning", "travel loyalty programs", "film distribution windows"),
        ("energy", "infrastructure", "utilities"),
    ),
    BenchmarkCaseSpec(
        "advanced-reactors",
        "advanced reactor supply chains",
        "Advanced Reactor Supply Chains",
        ("Foundations", "Fuel Services", "Forgings", "Qualification", "Manufacturing Capacity", "Outlook"),
        ("mobile game monetization", "music touring logistics", "celebrity fragrance launches"),
        ("energy", "manufacturing", "nuclear"),
    ),
    BenchmarkCaseSpec(
        "ai-curriculum",
        "AI curriculum design for secondary schools",
        "AI Curriculum Design",
        ("Foundations", "Teacher Readiness", "Assessment", "Safety Controls", "Inclusion", "Implementation"),
        ("festival stage design", "sports sponsorship packages", "fashion retail campaigns"),
        ("education", "technology", "policy"),
    ),
    BenchmarkCaseSpec(
        "advanced-packaging",
        "semiconductor advanced packaging capacity bottlenecks",
        "Semiconductor Advanced Packaging",
        ("Foundations", "Capacity", "Equipment", "Yield", "Supply Risk", "Strategic Outlook"),
        ("streaming ad sales", "film sequel marketing", "influencer merchandise"),
        ("manufacturing", "technology", "supply-chain"),
    ),
    BenchmarkCaseSpec(
        "wildfire-smoke",
        "urban wildfire smoke preparedness",
        "Urban Wildfire Smoke Preparedness",
        ("Foundations", "Exposure Risk", "Public Health", "Monitoring", "Response Systems", "Forward View"),
        ("concert venue promotion", "luxury travel itineraries", "fashion launch events"),
        ("environment", "health", "policy"),
    ),
    BenchmarkCaseSpec(
        "zero-trust",
        "zero trust architecture for hybrid government networks",
        "Zero Trust Architecture",
        ("Foundations", "Identity Controls", "Segmentation", "Monitoring", "Threat Response", "Strategy"),
        ("celebrity fan communities", "music streaming growth", "festival VIP experiences"),
        ("cybersecurity", "government", "infrastructure"),
    ),
    BenchmarkCaseSpec(
        "precision-irrigation",
        "precision irrigation data platforms",
        "Precision Irrigation Data Platforms",
        ("Foundations", "Sensors", "Water Efficiency", "Farm Operations", "Economics", "Outlook"),
        ("fashion resale marketplaces", "podcast sponsorship trends", "luxury retail rollout"),
        ("agriculture", "technology", "operations"),
    ),
    BenchmarkCaseSpec(
        "battery-recycling-logistics",
        "battery recycling logistics for commercial fleets",
        "Battery Recycling Logistics",
        ("Foundations", "Collection Systems", "Transport Safety", "Processing Capacity", "Economics", "Future Outlook"),
        ("film festival logistics", "concert merchandise shipping", "celebrity perfume distribution"),
        ("transport", "environment", "supply-chain"),
    ),
    BenchmarkCaseSpec(
        "critical-minerals",
        "critical minerals strategy in southeast asia",
        "Critical Minerals Strategy",
        ("Foundations", "Resource Position", "Industrial Policy", "Refining Capacity", "Tradeoffs", "Outlook"),
        ("festival travel demand", "luxury cruise itineraries", "fashion week programming"),
        ("geopolitics", "policy", "supply-chain"),
        ("Southeast Asia", "ASEAN", "regional investment"),
    ),
    BenchmarkCaseSpec(
        "port-automation",
        "port automation workforce transition planning",
        "Port Automation Workforce Transition",
        ("Foundations", "Labor Transition", "Terminal Systems", "Safety Controls", "Economics", "Outlook"),
        ("movie release calendars", "festival lineups", "celebrity cruise packages"),
        ("logistics", "labor", "transport"),
    ),
    BenchmarkCaseSpec(
        "water-reuse",
        "industrial water reuse system design",
        "Industrial Water Reuse Systems",
        ("Foundations", "Treatment Design", "Process Integration", "Regulatory Constraints", "Economics", "Future Outlook"),
        ("fashion retail shelving", "podcast ad sales", "sports ticket bundles"),
        ("water", "manufacturing", "environment"),
    ),
    BenchmarkCaseSpec(
        "telecom-open-ran",
        "open ran deployment economics for telecom operators",
        "Open RAN Deployment Economics",
        ("Foundations", "Radio Architecture", "Vendor Strategy", "Cost Structure", "Risk Factors", "Outlook"),
        ("film soundtrack marketing", "festival hotel pricing", "influencer ad spend"),
        ("telecom", "technology", "infrastructure"),
    ),
    BenchmarkCaseSpec(
        "defense-logistics",
        "contested logistics for maritime defense operations",
        "Contested Maritime Logistics",
        ("Foundations", "Sustainment", "Fuel and Munitions", "Risk Mitigation", "Operational Tradeoffs", "Forward View"),
        ("luxury cruise dining", "concert stage routing", "fashion launch campaigns"),
        ("defense", "logistics", "maritime"),
    ),
    BenchmarkCaseSpec(
        "housing-permits",
        "housing permit reform and urban supply constraints",
        "Housing Permit Reform",
        ("Foundations", "Zoning Friction", "Approval Timelines", "Developer Incentives", "Policy Tradeoffs", "Outlook"),
        ("music festival venue planning", "travel influencer itineraries", "fashion showroom openings"),
        ("urban-planning", "policy", "housing"),
    ),
    BenchmarkCaseSpec(
        "insurance-climate",
        "insurance pricing under climate catastrophe risk",
        "Climate Catastrophe Insurance Pricing",
        ("Foundations", "Risk Models", "Reinsurance", "Capital Costs", "Regulation", "Forward Outlook"),
        ("luxury retail footfall", "sports sponsorship renewals", "concert ticket marketing"),
        ("insurance", "finance", "climate"),
    ),
    BenchmarkCaseSpec(
        "aerospace-saf",
        "sustainable aviation fuel supply chain scaling",
        "Sustainable Aviation Fuel Scaling",
        ("Foundations", "Feedstocks", "Refining Capacity", "Airline Demand", "Policy Support", "Future Outlook"),
        ("festival catering demand", "fashion week logistics", "music touring budgets"),
        ("aviation", "energy", "supply-chain"),
    ),
    BenchmarkCaseSpec(
        "biomanufacturing",
        "biomanufacturing capacity planning for cell therapies",
        "Cell Therapy Biomanufacturing Capacity",
        ("Foundations", "Process Design", "Facility Capacity", "Quality Systems", "Cost Drivers", "Outlook"),
        ("beauty brand launches", "festival merchandise demand", "celebrity skincare endorsements"),
        ("biotech", "health", "manufacturing"),
    ),
    BenchmarkCaseSpec(
        "robotics-warehousing",
        "warehouse robotics integration and throughput optimization",
        "Warehouse Robotics Integration",
        ("Foundations", "Systems Integration", "Throughput Metrics", "Labor Coordination", "Failure Modes", "Strategy"),
        ("fashion retail promotions", "movie franchise tie-ins", "music platform growth"),
        ("robotics", "logistics", "operations"),
    ),
    BenchmarkCaseSpec(
        "food-security",
        "regional food security strategy under fertilizer shocks",
        "Regional Food Security Strategy",
        ("Foundations", "Input Constraints", "Trade Exposure", "Crop Strategy", "Policy Response", "Outlook"),
        ("festival menu planning", "celebrity restaurant branding", "luxury resort catering"),
        ("agriculture", "policy", "food"),
    ),
    BenchmarkCaseSpec(
        "materials-recycling",
        "rare earth magnet recycling economics",
        "Rare Earth Magnet Recycling Economics",
        ("Foundations", "Collection Systems", "Processing Methods", "Industrial Demand", "Cost Structure", "Future Outlook"),
        ("music merchandise reuse", "fashion resale trends", "festival waste cleanup"),
        ("materials", "manufacturing", "environment"),
    ),
    BenchmarkCaseSpec(
        "public-cloud-sovereignty",
        "public cloud sovereignty controls for government data",
        "Public Cloud Sovereignty Controls",
        ("Foundations", "Jurisdictional Risk", "Identity Controls", "Data Residency", "Procurement Tradeoffs", "Outlook"),
        ("sports fan loyalty apps", "film award campaigns", "luxury retail CRM"),
        ("government", "cloud", "cybersecurity"),
    ),
    BenchmarkCaseSpec(
        "rail-electrification",
        "rail electrification program delivery risk",
        "Rail Electrification Delivery Risk",
        ("Foundations", "Infrastructure Scope", "Cost Escalation", "Supply Constraints", "Program Controls", "Outlook"),
        ("concert venue electrics", "festival lighting design", "fashion runway production"),
        ("transport", "infrastructure", "energy"),
    ),
    BenchmarkCaseSpec(
        "mining-tailings",
        "tailings dam monitoring and failure prevention",
        "Tailings Dam Monitoring",
        ("Foundations", "Monitoring Systems", "Hydrology", "Failure Prevention", "Regulation", "Evidence"),
        ("luxury spa water features", "travel resort landscaping", "festival venue drainage"),
        ("mining", "environment", "safety"),
    ),
    BenchmarkCaseSpec(
        "retail-media",
        "retail media network economics for supermarkets",
        "Retail Media Network Economics",
        ("Foundations", "Ad Inventory", "Data Strategy", "Margin Structure", "Measurement", "Forward View"),
        ("music streaming ads", "festival sponsor packages", "film trailer buys"),
        ("retail", "advertising", "business"),
    ),
    BenchmarkCaseSpec(
        "legaltech-discovery",
        "legal document review workflow automation",
        "Legal Document Review Automation",
        ("Foundations", "Workflow Design", "Quality Control", "Risk Management", "Economics", "Implementation"),
        ("fashion content moderation", "celebrity fan mail sorting", "festival credentialing"),
        ("legal", "automation", "operations"),
    ),
)


def build_benchmark_packs(
    case_specs: Sequence[BenchmarkCaseSpec] = BENCHMARK_CASE_SPECS,
) -> List[Dict[str, Any]]:
    grouped: Dict[str, List[BenchmarkCaseSpec]] = {}
    for case in case_specs:
        for tag in case.tags:
            grouped.setdefault(tag, []).append(case)

    packs = [
        {
            "pack_name": tag,
            "cases": tuple(cases),
        }
        for tag, cases in sorted(grouped.items())
    ]
    packs.append({
        "pack_name": "all",
        "cases": tuple(case_specs),
    })
    return packs


def _authority_for_rank(rank: int) -> float:
    authority_scale = (0.91, 0.88, 0.82, 0.78, 0.74, 0.71, 0.58, 0.42)
    return authority_scale[min(rank, len(authority_scale) - 1)]


def _provider_for_rank(rank: int) -> str:
    providers = ("manual", "manual", "manual", "google", "bing", "wikipedia", "google", "google")
    return providers[min(rank, len(providers) - 1)]


def _slug(value: str) -> str:
    return "-".join(tokenize(value)) or "source"


def build_case_population(case: BenchmarkCaseSpec) -> List[Dict[str, Any]]:
    population: List[Dict[str, Any]] = []
    geography_phrase = ", ".join(case.geography_terms)
    query_phrase = normalize_space(case.query)

    for index, facet in enumerate(case.facets):
        supporting_facets = [item for item in case.facets if item != facet][:2]
        facet_phrase = normalize_space(facet)
        topic_phrase = normalize_space(case.topic_label)
        context_phrase = normalize_space(" ".join(case.geography_terms[:3]))
        definitions = [
            {
                "term": topic_phrase if index == 0 else facet_phrase,
                "description": (
                    f"{topic_phrase} is evaluated through {facet_phrase.lower()} in relation to {query_phrase}."
                    f"{(' ' + geography_phrase) if geography_phrase else ''}"
                ),
                "sourceUrl": f"https://{case.case_id}-{index}.example/reference",
            }
        ]
        subtopics = [
            {
                "title": supporting_facets[0] if supporting_facets else f"{facet_phrase} Context",
                "summary": (
                    f"{supporting_facets[0] if supporting_facets else facet_phrase} influences execution, evidence, "
                    f"and tradeoffs for {topic_phrase.lower()}."
                ),
                "sourceUrl": f"https://{case.case_id}-{index}.example/reference",
            }
        ]
        content = normalize_space(
            f"{topic_phrase} is an analytical frame for {query_phrase}. "
            f"This source explains {facet_phrase.lower()} with attention to {', '.join(supporting_facets) or topic_phrase}. "
            f"It describes operating constraints, evidence, risks, implementation patterns, and strategic implications"
            f"{(' across ' + context_phrase) if context_phrase else ''}."
        )
        population.append({
            "url": f"https://{case.case_id}-{index}.benchmark/{_slug(facet_phrase)}",
            "title": f"{topic_phrase}: {facet_phrase}",
            "content": content,
            "definitions": definitions,
            "subTopics": subtopics,
            "informativeScore": round(0.92 - (index * 0.035), 4),
            "authorityScore": round(_authority_for_rank(index), 4),
            "searchProvider": _provider_for_rank(index),
        })

    duplicate = dict(population[0])
    duplicate["url"] = f"https://{case.case_id}-duplicate.benchmark/overview"
    duplicate["title"] = f"{case.topic_label} overview and fundamentals"
    duplicate["authorityScore"] = 0.63
    duplicate["informativeScore"] = 0.66
    population.append(duplicate)

    population.append({
        "url": f"https://{case.case_id}-listicle.benchmark/top-tips",
        "title": f"Top 7 {case.topic_label.lower()} tips",
        "content": (
            f"Best tips for {case.topic_label.lower()} fast. Reasons reasons reasons. "
            f"{case.topic_label.lower()} checklist and quick wins."
        ),
        "definitions": [],
        "subTopics": [],
        "informativeScore": 0.34,
        "authorityScore": 0.38,
        "searchProvider": "google",
    })

    distractor_label = normalize_space(case.distractor_terms[0])
    distractor_summary = normalize_space(" ".join(case.distractor_terms[1:]))
    population.append({
        "url": f"https://{case.case_id}-distractor.benchmark/off-topic",
        "title": f"{tokenize(case.query)[0].title()} trends in {distractor_label}",
        "content": (
            f"This page discusses {distractor_label} and {distractor_summary}. "
            f"It only loosely overlaps with {query_phrase} through generic planning language."
        ),
        "definitions": [],
        "subTopics": [],
        "informativeScore": 0.29,
        "authorityScore": 0.33,
        "searchProvider": "google",
    })

    return population


def _coverage_ratio(results: Sequence[Dict[str, Any]], query: str) -> float:
    q_words = query_words(query)
    focus_words = expand_query_focus_words(q_words)
    if not focus_words:
        return 1.0

    covered = set()
    for result in results:
        result_words = set(tokenize(result.get("title", "") + " " + result.get("content", "")))
        covered.update(result_words.intersection(focus_words))
    return len(covered) / max(len(focus_words), 1)


def _redundancy(results: Sequence[Dict[str, Any]]) -> float:
    signatures = [content_signature_tokens(result.get("content", "")) for result in results]
    overlaps = []
    for index, signature in enumerate(signatures):
        for other in signatures[index + 1:]:
            overlaps.append(jaccard_similarity(signature, other))
    return average(overlaps, 0.0)


def _chapter_distinctness(webbook: Dict[str, Any]) -> float:
    chapter_token_sets = [
        set(tokenize(chapter.get("title", "") + " " + chapter.get("content", "")))
        for chapter in webbook.get("chapters", [])
    ]
    overlaps = []
    for index, token_set in enumerate(chapter_token_sets):
        for other in chapter_token_sets[index + 1:]:
            overlaps.append(jaccard_similarity(token_set, other))
    return 1.0 - average(overlaps, 0.0)


def _quantile(values: Sequence[float], percentile: float) -> float:
    ordered = sorted(values)
    if not ordered:
        return 0.0
    if len(ordered) == 1:
        return ordered[0]

    position = (len(ordered) - 1) * percentile
    lower_index = int(position)
    upper_index = min(lower_index + 1, len(ordered) - 1)
    weight = position - lower_index
    return ordered[lower_index] * (1.0 - weight) + ordered[upper_index] * weight


def _metric_distribution(values: Sequence[float]) -> Dict[str, float]:
    ordered = sorted(values)
    if not ordered:
        return {
            "mean": 0.0,
            "median": 0.0,
            "stdev": 0.0,
            "min": 0.0,
            "max": 0.0,
            "p25": 0.0,
            "p75": 0.0,
        }

    return {
        "mean": round(average(ordered, 0.0), 6),
        "median": round(statistics.median(ordered), 6),
        "stdev": round(statistics.pstdev(ordered), 6) if len(ordered) > 1 else 0.0,
        "min": round(ordered[0], 6),
        "max": round(ordered[-1], 6),
        "p25": round(_quantile(ordered, 0.25), 6),
        "p75": round(_quantile(ordered, 0.75), 6),
    }


def run_benchmark_case(case: BenchmarkCaseSpec) -> Dict[str, Any]:
    raw_population = build_case_population(case)
    ranked_population = rank_frontier_results(
        raw_population,
        case.query,
        query_words=query_words,
        expand_query_focus_words=expand_query_focus_words,
        tokenize=tokenize,
        normalize_space=normalize_space,
        source_relevance=source_relevance,
    )[:18]
    evolved_sources = evolve(ranked_population, case.query)
    webbook = generate_webbook(evolved_sources, case.query)

    metrics = {
        "average_relevance": round(average([source_relevance(item, query_words(case.query)) for item in evolved_sources], 0.0), 6),
        "focus_coverage": round(_coverage_ratio(evolved_sources, case.query), 6),
        "redundancy": round(_redundancy(evolved_sources), 6),
        "chapter_distinctness": round(_chapter_distinctness(webbook), 6),
        "average_authority": round(average([float(item.get("authorityScore", 0.5)) for item in evolved_sources], 0.5), 6),
    }
    return {
        "case_id": case.case_id,
        "query": case.query,
        "tags": list(case.tags),
        "population_size": len(raw_population),
        "ranked_size": len(ranked_population),
        "evolved_size": len(evolved_sources),
        "chapter_count": len(webbook.get("chapters", [])),
        "metrics": metrics,
    }


def aggregate_benchmark_runs(runs: Sequence[Dict[str, Any]]) -> Dict[str, Any]:
    if not runs:
        return {
            "case_count": 0,
            "average_relevance": 0.0,
            "focus_coverage": 0.0,
            "redundancy": 0.0,
            "chapter_distinctness": 0.0,
            "average_authority": 0.0,
            "distribution": {
                "average_relevance": _metric_distribution(()),
                "focus_coverage": _metric_distribution(()),
                "redundancy": _metric_distribution(()),
                "chapter_distinctness": _metric_distribution(()),
                "average_authority": _metric_distribution(()),
            },
        }

    metric_keys = (
        "average_relevance",
        "focus_coverage",
        "redundancy",
        "chapter_distinctness",
        "average_authority",
    )
    metric_values = {
        key: [run["metrics"][key] for run in runs]
        for key in metric_keys
    }
    return {
        "case_count": len(runs),
        "average_relevance": round(average(metric_values["average_relevance"], 0.0), 6),
        "focus_coverage": round(average(metric_values["focus_coverage"], 0.0), 6),
        "redundancy": round(average(metric_values["redundancy"], 0.0), 6),
        "chapter_distinctness": round(average(metric_values["chapter_distinctness"], 0.0), 6),
        "average_authority": round(average(metric_values["average_authority"], 0.5), 6),
        "distribution": {
            key: _metric_distribution(values)
            for key, values in metric_values.items()
        },
    }


def run_benchmark_pack(pack_name: str, case_specs: Sequence[BenchmarkCaseSpec]) -> Dict[str, Any]:
    runs = [run_benchmark_case(case) for case in case_specs]
    return {
        "pack_name": pack_name,
        "summary": aggregate_benchmark_runs(runs),
        "cases": runs,
    }


def run_benchmark_suite(
    case_specs: Sequence[BenchmarkCaseSpec] = BENCHMARK_CASE_SPECS,
) -> Dict[str, Any]:
    suite_runs = {
        case.case_id: run_benchmark_case(case)
        for case in case_specs
    }
    packs = []
    for pack in build_benchmark_packs(case_specs):
        if pack["pack_name"] == "all":
            continue
        pack_runs = [suite_runs[case.case_id] for case in pack["cases"]]
        packs.append({
            "pack_name": pack["pack_name"],
            "summary": aggregate_benchmark_runs(pack_runs),
            "cases": pack_runs,
        })
    return {
        "pack_count": len(packs),
        "case_count": len(case_specs),
        "packs": packs,
        "summary": aggregate_benchmark_runs(list(suite_runs.values())),
    }


def filter_benchmark_cases_by_tag(
    tag: str,
    case_specs: Sequence[BenchmarkCaseSpec] = BENCHMARK_CASE_SPECS,
) -> List[BenchmarkCaseSpec]:
    return [case for case in case_specs if tag in case.tags]
