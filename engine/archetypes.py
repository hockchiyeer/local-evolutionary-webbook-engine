"""Generic query-archetype inference for topic-aware fallback and assembly."""

from __future__ import annotations

import re
from difflib import SequenceMatcher
from typing import Any, Callable, Dict, List, Sequence, Set, Tuple

from .query_profiles import build_query_profile


QUESTION_WORDS = {
    "what", "when", "where", "which", "who", "why", "how",
    "can", "could", "should", "would", "will", "may", "might",
}

COMPARISON_TOKENS = {"vs", "versus", "against"}

PERSON_SUPPORT_TERMS = {
    "biography", "biographical", "born", "career", "legacy", "leader", "leadership",
    "politician", "statesman", "prime", "minister", "president", "founder", "author",
    "scientist", "artist", "writer", "actor", "activist", "speech", "government",
    "administration", "office", "cabinet", "reform",
}

ORGANIZATION_QUERY_TERMS = {
    "business", "company", "corporate", "earnings", "equity", "guidance",
    "editorial", "journalism", "magazine", "media", "newspaper", "newsroom",
    "management", "margin", "margins", "outlet", "platform", "press",
    "product", "products", "publication", "publisher", "revenue", "revenues",
    "shareholder", "stock", "stocks", "valuation",
}

ORGANIZATION_SUPPORT_TERMS = {
    "board", "business model", "customer", "customers", "ecosystem", "editorial",
    "executive", "gross margin", "journalism", "management", "market share",
    "media outlet", "newsroom", "platform", "portfolio", "press freedom",
    "product", "products", "profit", "publication", "publisher", "reporting",
    "revenue", "revenues", "supplier",
}

MARKET_QUERY_TERMS = {
    "capital", "capacity", "commodity", "commodities", "demand", "equities",
    "equity", "exchange", "exports", "industry", "industries", "investment",
    "investments", "liquidity", "logistics", "manufacturing", "market", "markets",
    "pricing", "production", "sector", "sectors", "shipping", "supply", "trade",
    "valuation", "yields",
}

MARKET_SUPPORT_TERMS = {
    "capital flow", "capital flows", "commodity", "commodities", "currency stability",
    "demand", "disclosure", "earnings", "exchange", "foreign inflow", "foreign investment",
    "inventory", "liquidity", "market", "pricing", "production", "regulation",
    "sector rotation", "supply chain", "trade", "valuation",
}

TECHNOLOGY_QUERY_TERMS = {
    "ai", "aerospace", "algorithm", "algorithms", "api", "apis", "astronaut",
    "automation", "chip", "chips", "cloud", "compute", "cybersecurity", "data",
    "digital", "launch", "lunar", "mission", "missions", "model", "models",
    "moon", "nasa", "orbit", "orbital", "orion", "platform", "platforms",
    "robotics", "rocket", "rockets", "semiconductor", "semiconductors", "software",
    "space", "spacecraft", "technology", "technologies",
}

TECHNOLOGY_SUPPORT_TERMS = {
    "adoption", "astronaut", "benchmark", "capability", "capabilities", "chip",
    "chips", "cloud", "compute", "crew", "data center", "deployment",
    "ecosystem", "evaluation", "frontier model", "frontier models", "governance",
    "inference", "launch", "lunar", "mission", "mission architecture", "model",
    "models", "moon", "nasa", "orbit", "orbital", "orion", "payload",
    "platform", "platforms", "rocket", "safety", "software", "spacecraft",
    "workflows",
}

ORGANIZATION_TERMS = {
    "inc", "corp", "corporation", "company", "co", "group", "bank", "university",
    "committee", "association", "ministry", "agency", "foundation", "institute",
    "council", "department",
}

PLACE_TERMS = {
    "country", "state", "city", "province", "region", "district", "island", "nation",
    "kingdom", "republic", "federation", "territory",
}

PLACE_QUERY_TERMS = {
    "border", "elevation", "glacier", "himalaya", "himalayas", "mount", "mountain",
    "peak", "plateau", "route", "summit", "terrain", "valley", "volcano",
}

PLACE_SUPPORT_TERMS = {
    "border", "capital city", "city-state", "demographic", "elevation", "glacier",
    "governance", "housing policy", "infrastructure planning", "institutional structure",
    "mountain", "peak", "population", "regional role", "summit", "urban system",
    "valley",
}

PLACE_NAME_PREFIXES = {"mount", "mt"}

PERSON_CHAPTER_TEMPLATES: Sequence[Tuple[str, Set[str]]] = (
    ("Background and Identity", {"background", "identity", "biography", "origin", "early"}),
    ("Early Life and Formation", {"early", "formation", "education", "career", "development"}),
    ("Rise to Prominence", {"rise", "office", "leadership", "milestone", "turning"}),
    ("Leadership and Governance", {"leadership", "governance", "administration", "decision", "role"}),
    ("Policies and Contributions", {"policy", "contribution", "reform", "initiative", "achievement"}),
    ("Domestic Impact", {"domestic", "society", "economy", "institution", "impact"}),
    ("International Role", {"international", "regional", "diplomacy", "foreign", "influence"}),
    ("Debate and Criticism", {"debate", "criticism", "controversy", "opposition", "challenge"}),
    ("Legacy and Interpretation", {"legacy", "interpretation", "history", "evidence", "assessment"}),
    ("Contemporary Relevance", {"contemporary", "current", "relevance", "outlook", "influence"}),
)

PERSON_FALLBACK_FACETS: Sequence[Tuple[str, str]] = (
    ("Background and Identity", "biographical background, formative influences, and the public identity associated with the person"),
    ("Career Milestones", "career progression, appointments, turning points, and the path to public prominence"),
    ("Leadership and Roles", "leadership style, institutional roles, and the decision patterns attached to the person"),
    ("Major Contributions", "reforms, ideas, works, or enduring contributions most often linked to the person"),
    ("Networks and Influence", "alliances, institutions, constituencies, and spheres of influence surrounding the person"),
    ("Public Debate and Criticism", "criticisms, controversies, opposition arguments, and contested interpretations"),
    ("Domestic Impact", "effects on institutions, society, industry, or public life in the main national or organizational setting"),
    ("International Significance", "regional or global influence, diplomacy, reputation, and external perceptions where relevant"),
    ("Legacy", "long-term institutional, ideological, developmental, or cultural effects associated with the person"),
    ("Contemporary Relevance", "how present debates reinterpret the person's record and why the subject still matters"),
)

IMPACT_CHAPTER_TEMPLATES: Sequence[Tuple[str, Set[str]]] = (
    ("Conflict Overview", {"overview", "conflict", "war", "scope", "background"}),
    ("Immediate Triggers", {"trigger", "cause", "flashpoint", "decision", "initiation"}),
    ("Regional Military Dynamics", {"regional", "military", "escalation", "security", "deterrence"}),
    ("Energy and Trade", {"energy", "oil", "trade", "shipping", "supply"}),
    ("Diplomatic Realignment", {"diplomacy", "alignment", "alliance", "mediation", "sanctions"}),
    ("Domestic Political Effects", {"domestic", "political", "governance", "regime", "public"}),
    ("Security Architecture", {"security", "defense", "architecture", "military", "posture"}),
    ("Economic Spillovers", {"economy", "spillover", "inflation", "markets", "investment"}),
    ("Scenario Paths", {"scenario", "path", "trajectory", "branch", "future"}),
    ("Long-Horizon Outlook", {"outlook", "legacy", "decade", "systemic", "consequence"}),
)

ORGANIZATION_CHAPTER_TEMPLATES: Sequence[Tuple[str, Set[str]]] = (
    ("Identity and Positioning", {"identity", "position", "mandate", "brand", "overview"}),
    ("Operating Model", {"business", "model", "operation", "revenue", "workflow"}),
    ("Products and Capabilities", {"product", "portfolio", "capability", "platform", "technology"}),
    ("Market Position", {"market", "competition", "customer", "segment", "share"}),
    ("Leadership and Governance", {"leadership", "governance", "management", "board", "allocation"}),
    ("Economics and Performance", {"revenue", "margin", "growth", "profit", "performance"}),
    ("Partnerships and Ecosystem", {"partner", "ecosystem", "supplier", "channel", "alliance"}),
    ("Risks and Constraints", {"risk", "regulation", "constraint", "exposure", "supply"}),
    ("Strategy and Execution", {"strategy", "execution", "investment", "roadmap", "prioritization"}),
    ("Outlook and Scenarios", {"outlook", "scenario", "guidance", "future", "trajectory"}),
)

ORGANIZATION_FALLBACK_FACETS: Sequence[Tuple[str, str]] = (
    ("Identity and Positioning", "the organization's mandate, brand, market identity, and the role it plays in the wider landscape"),
    ("Operating Model", "how the organization creates value through its business model, operations, and structural revenue logic"),
    ("Products and Capabilities", "the main products, technical capabilities, service layers, or strategic assets that define the offering"),
    ("Market Position", "how the organization competes, where it is differentiated, and which customer segments matter most"),
    ("Leadership and Governance", "how leadership, management discipline, governance structures, and capital allocation shape outcomes"),
    ("Economics and Performance", "how revenue quality, margins, growth, and operating leverage influence performance"),
    ("Partnerships and Ecosystem", "how suppliers, partners, channels, developers, and alliances expand or constrain the organization"),
    ("Risks and Constraints", "which regulatory, supply, competitive, execution, or concentration risks most affect the organization"),
    ("Strategy and Execution", "how the organization prioritizes investments, sequences execution, and translates strategy into operating results"),
    ("Outlook and Scenarios", "which forward scenarios, guidance ranges, and structural shifts most affect the organization's outlook"),
)

PLACE_CHAPTER_TEMPLATES: Sequence[Tuple[str, Set[str]]] = (
    ("Geographic Context", {"geography", "location", "territory", "land", "context"}),
    ("Historical Formation", {"history", "formation", "timeline", "colonial", "development"}),
    ("Institutions and Governance", {"institution", "governance", "policy", "state", "administration"}),
    ("Economic Base", {"economy", "trade", "industry", "finance", "growth"}),
    ("Society and Demographics", {"society", "demography", "population", "labor", "community"}),
    ("Infrastructure and Urban Systems", {"infrastructure", "transport", "housing", "urban", "planning"}),
    ("Culture and Identity", {"culture", "identity", "language", "heritage", "civic"}),
    ("Regional and Global Role", {"regional", "global", "trade", "diplomacy", "positioning"}),
    ("Development Challenges", {"challenge", "constraint", "inequality", "resource", "pressure"}),
    ("Long-Term Outlook", {"outlook", "future", "development", "trajectory", "resilience"}),
)

PLACE_FALLBACK_FACETS: Sequence[Tuple[str, str]] = (
    ("Geographic Context", "the physical setting, territorial context, and spatial conditions that frame the place"),
    ("Historical Formation", "the historical path that shaped institutions, settlement patterns, and the present-day development model"),
    ("Institutions and Governance", "how state institutions, governance arrangements, and policy choices organize the place"),
    ("Economic Base", "the industries, trade linkages, labor patterns, and revenue engines that sustain the local economy"),
    ("Society and Demographics", "population structure, social composition, migration patterns, and demographic pressures"),
    ("Infrastructure and Urban Systems", "how transport, housing, utilities, and planning systems support daily function and long-run growth"),
    ("Culture and Identity", "the cultural narratives, civic identity, and social norms that shape how the place is interpreted"),
    ("Regional and Global Role", "how the place relates to neighboring regions, global networks, trade routes, or diplomacy"),
    ("Development Challenges", "which structural bottlenecks, policy tensions, or resource constraints complicate future development"),
    ("Long-Term Outlook", "the major trajectories, risks, and resilience factors that shape the place over the next decade"),
)

MARKET_CHAPTER_TEMPLATES: Sequence[Tuple[str, Set[str]]] = (
    ("Market Foundations", {"market", "scope", "structure", "baseline", "overview"}),
    ("Demand Drivers", {"demand", "consumption", "customer", "earnings", "spending"}),
    ("Supply and Capacity", {"supply", "capacity", "production", "inventory", "throughput"}),
    ("Capital Flows and Liquidity", {"capital", "flow", "liquidity", "funding", "valuation"}),
    ("Competition and Positioning", {"competition", "position", "sector", "rotation", "share"}),
    ("Policy and Regulation", {"policy", "regulation", "governance", "disclosure", "standards"}),
    ("Economics and Pricing", {"pricing", "cost", "margin", "commodity", "economics"}),
    ("Risks and Constraints", {"risk", "constraint", "volatility", "bottleneck", "exposure"}),
    ("Strategic Scenarios", {"scenario", "strategy", "allocation", "decision", "rotation"}),
    ("Forward Outlook", {"outlook", "future", "trajectory", "signals", "forecast"}),
)

MARKET_FALLBACK_FACETS: Sequence[Tuple[str, str]] = (
    ("Market Foundations", "the baseline market structure, scope, participants, and how value moves through the system"),
    ("Demand Drivers", "which customer needs, earnings trends, spending patterns, or end-use conditions most shape demand"),
    ("Supply and Capacity", "how production, inventory, logistics, throughput, and capacity constraints shape supply"),
    ("Capital Flows and Liquidity", "how investment, cross-border flows, liquidity conditions, and valuation discipline affect the market"),
    ("Competition and Positioning", "how sectors, firms, substitutes, or strategic positions shift advantage across the market"),
    ("Policy and Regulation", "how regulation, disclosure standards, industrial policy, or market rules shape participant behavior"),
    ("Economics and Pricing", "how pricing power, cost structures, commodity linkages, and unit economics affect performance"),
    ("Risks and Constraints", "which bottlenecks, volatility sources, policy shocks, or operational risks most threaten the market"),
    ("Strategic Scenarios", "the main branching scenarios, allocation choices, and decision frameworks that matter for market participants"),
    ("Forward Outlook", "the next-stage trajectory, leading indicators, and structural questions that define the market outlook"),
)

TECHNOLOGY_CHAPTER_TEMPLATES: Sequence[Tuple[str, Set[str]]] = (
    ("Capital and Compute", {"capital", "compute", "investment", "infrastructure", "scaling"}),
    ("Capability Frontier", {"capability", "frontier", "performance", "benchmark", "model"}),
    ("Infrastructure Stack", {"infrastructure", "stack", "data", "chip", "cloud"}),
    ("Product and Workflow Adoption", {"product", "workflow", "adoption", "deployment", "use"}),
    ("Ecosystem and Competition", {"ecosystem", "competition", "platform", "vendor", "open"}),
    ("Economics and Commercialization", {"economics", "revenue", "cost", "commercialization", "incentive"}),
    ("Governance and Risk", {"governance", "risk", "safety", "policy", "security"}),
    ("Measurement and Evidence", {"measurement", "evaluation", "evidence", "metric", "benchmark"}),
    ("Strategy and Execution", {"strategy", "execution", "integration", "capability", "procurement"}),
    ("Future Trajectories", {"future", "trend", "scenario", "roadmap", "trajectory"}),
)

TECHNOLOGY_FALLBACK_FACETS: Sequence[Tuple[str, str]] = (
    ("Capital and Compute", "how investment, compute access, and infrastructure scale shape the pace and direction of the technology"),
    ("Capability Frontier", "what the leading performance frontier looks like and which technical capabilities define progress"),
    ("Infrastructure Stack", "which chips, data systems, cloud layers, and enabling infrastructure support deployment"),
    ("Product and Workflow Adoption", "how the technology moves from prototype to real workflow adoption and user value"),
    ("Ecosystem and Competition", "how vendors, open ecosystems, platform control, and substitutes shape competition"),
    ("Economics and Commercialization", "how costs, pricing, monetization, and incentives determine commercial viability"),
    ("Governance and Risk", "which safety, policy, legal, and operational risks most shape adoption"),
    ("Measurement and Evidence", "which benchmarks, evaluation methods, and evidence streams best indicate progress or limits"),
    ("Strategy and Execution", "how organizations prioritize bets, build capabilities, and sequence implementation"),
    ("Future Trajectories", "the most plausible future paths, scenario splits, and structural uncertainties ahead"),
)

IMPACT_FALLBACK_FACETS: Sequence[Tuple[str, str]] = (
    ("Conflict Overview", "the baseline structure, actors, escalation pathway, and immediate stakes of the conflict"),
    ("Immediate Triggers", "the proximate decisions, flashpoints, and strategic triggers that converted tension into war"),
    ("Regional Military Dynamics", "how force posture, deterrence failure, regional proxies, and escalation risks shape the conflict"),
    ("Energy and Trade", "how shipping, oil, sanctions, and supply-chain disruption transmit the conflict into the wider world"),
    ("Diplomatic Realignment", "how states reposition, hedge, sanction, mediate, or harden alliances as the conflict unfolds"),
    ("Domestic Political Effects", "how the conflict changes regime stability, civil society, internal repression, and state capacity"),
    ("Security Architecture", "how the war alters long-run defense posture, arms racing, alliance commitments, and regional security design"),
    ("Economic Spillovers", "how inflation, markets, investment, and fiscal burdens change across regions over time"),
    ("Scenario Paths", "the main branching trajectories, escalation ladders, and negotiated off-ramps that determine next steps"),
    ("Long-Horizon Outlook", "the decade-scale structural consequences for geopolitics, energy, institutions, and strategic competition"),
)


def _raw_word_tokens(text: str) -> List[str]:
    return re.findall(r"[A-Za-z][A-Za-z'.-]{1,}", str(text or ""))


def _looks_like_titled_name(token: str) -> bool:
    return bool(token) and token[0].isupper()


def _supports_person_archetype(
    supporting_results: Sequence[Dict[str, Any]],
    *,
    normalize_space: Callable[[Any], str],
) -> bool:
    score = 0
    for result in supporting_results[:6]:
        text = normalize_space(
            f"{result.get('title', '')} {result.get('content', '')[:420]}"
        ).lower()
        matches = sum(1 for term in PERSON_SUPPORT_TERMS if term in text)
        if matches >= 2:
            score += 2
        elif matches == 1:
            score += 1
        if "(born" in text or " prime minister" in text or " president" in text:
            score += 2
    return score >= 2


def _query_term_score(tokens: Sequence[str], terms: Set[str]) -> int:
    return sum(1 for token in tokens if token in terms)


def _support_term_score(
    supporting_results: Sequence[Dict[str, Any]],
    terms: Set[str],
    *,
    normalize_space: Callable[[Any], str],
) -> int:
    score = 0
    for result in supporting_results[:6]:
        text = normalize_space(
            f"{result.get('title', '')} {result.get('content', '')[:420]}"
        ).lower()
        matches = sum(1 for term in terms if term in text)
        if matches >= 4:
            score += 3
        elif matches >= 2:
            score += 2
        elif matches == 1:
            score += 1
    return score


def infer_query_archetype(
    query: str,
    supporting_results: Sequence[Dict[str, Any]] = (),
    *,
    tokenize: Callable[[str], Sequence[str]],
    stop_words: Set[str],
    normalize_space: Callable[[Any], str],
) -> str:
    normalized_query = normalize_space(query)
    query_profile = build_query_profile(normalized_query)
    raw_tokens = _raw_word_tokens(normalized_query)
    lowered_tokens = [token.lower() for token in raw_tokens]
    filtered_tokens = [token for token in lowered_tokens if token not in stop_words]
    title_case_ratio = sum(1 for token in raw_tokens if _looks_like_titled_name(token)) / max(len(raw_tokens), 1)
    comparison_query = any(token in COMPARISON_TOKENS for token in lowered_tokens)
    has_mount_prefix = bool(lowered_tokens) and lowered_tokens[0] in PLACE_NAME_PREFIXES

    if "impact_forecast" in query_profile.get("intent_tags", set()):
        return "impact"
    if "sports_event" in query_profile.get("intent_tags", set()):
        return "generic"

    organization_query_score = _query_term_score(filtered_tokens, ORGANIZATION_QUERY_TERMS)
    organization_support_score = _support_term_score(
        supporting_results,
        ORGANIZATION_SUPPORT_TERMS,
        normalize_space=normalize_space,
    )
    market_query_score = _query_term_score(filtered_tokens, MARKET_QUERY_TERMS)
    market_support_score = _support_term_score(
        supporting_results,
        MARKET_SUPPORT_TERMS,
        normalize_space=normalize_space,
    )
    technology_query_score = _query_term_score(filtered_tokens, TECHNOLOGY_QUERY_TERMS)
    technology_support_score = _support_term_score(
        supporting_results,
        TECHNOLOGY_SUPPORT_TERMS,
        normalize_space=normalize_space,
    )
    place_query_score = _query_term_score(filtered_tokens, PLACE_QUERY_TERMS)
    place_support_score = _support_term_score(
        supporting_results,
        PLACE_SUPPORT_TERMS,
        normalize_space=normalize_space,
    )
    person_support = _supports_person_archetype(supporting_results, normalize_space=normalize_space)

    if comparison_query and (organization_query_score >= 1 or organization_support_score >= 1):
        return "organization"

    if any(token in ORGANIZATION_TERMS for token in filtered_tokens):
        return "organization"
    if organization_query_score >= 2:
        return "organization"
    if organization_query_score >= 1 and any(_looks_like_titled_name(token) for token in raw_tokens):
        return "organization"
    if organization_support_score >= 3:
        return "organization"

    if market_query_score >= 2 or market_support_score >= 3:
        return "market"
    if technology_query_score >= 2 or technology_support_score >= 3:
        return "technology"

    if has_mount_prefix or place_query_score >= 2:
        return "place"
    if any(token in PLACE_TERMS for token in filtered_tokens):
        return "place"
    if place_support_score >= 2:
        return "place"
    if comparison_query and title_case_ratio >= 0.4:
        return "generic"
    if person_support:
        return "person"
    if 2 <= len(raw_tokens) <= 4:
        if (
            title_case_ratio >= 0.85
            and not comparison_query
            and not any(token in QUESTION_WORDS for token in lowered_tokens)
            and not any(token in ORGANIZATION_TERMS for token in lowered_tokens)
            and not any(token in PLACE_TERMS for token in lowered_tokens)
            and not any(token in PLACE_QUERY_TERMS for token in lowered_tokens)
            and not has_mount_prefix
        ):
            return "person"
    return "generic"


def choose_canonical_topic_label(
    query: str,
    supporting_results: Sequence[Dict[str, Any]] = (),
    *,
    normalize_space: Callable[[Any], str],
) -> str:
    normalized_query = normalize_space(query)
    if not supporting_results:
        return normalized_query

    best_label = normalized_query
    best_score = 0.0
    query_key = normalized_query.lower()

    for result in supporting_results[:8]:
        title = normalize_space(result.get("title", ""))
        if not title:
            continue
        candidate = re.split(r"\s+[|\-:]\s+|\s+\(|\s+\[", title, maxsplit=1)[0].strip(" -:|")
        if not candidate:
            continue
        candidate_score = SequenceMatcher(None, query_key, candidate.lower()).ratio()
        if candidate_score > best_score:
            best_score = candidate_score
            best_label = candidate

    if best_score >= 0.74:
        return best_label
    return normalized_query


def get_chapter_templates(
    default_templates: Sequence[Tuple[str, Set[str]]],
    query: str,
    supporting_results: Sequence[Dict[str, Any]] = (),
    *,
    tokenize: Callable[[str], Sequence[str]],
    stop_words: Set[str],
    normalize_space: Callable[[Any], str],
) -> Sequence[Tuple[str, Set[str]]]:
    archetype = infer_query_archetype(
        query,
        supporting_results,
        tokenize=tokenize,
        stop_words=stop_words,
        normalize_space=normalize_space,
    )
    if archetype == "person":
        return PERSON_CHAPTER_TEMPLATES
    if archetype == "impact":
        return IMPACT_CHAPTER_TEMPLATES
    if archetype == "organization":
        return ORGANIZATION_CHAPTER_TEMPLATES
    if archetype == "place":
        return PLACE_CHAPTER_TEMPLATES
    if archetype == "market":
        return MARKET_CHAPTER_TEMPLATES
    if archetype == "technology":
        return TECHNOLOGY_CHAPTER_TEMPLATES
    return default_templates


def get_fallback_facets(
    generic_facets: Sequence[Tuple[str, str]],
    query: str,
    supporting_results: Sequence[Dict[str, Any]] = (),
    *,
    tokenize: Callable[[str], Sequence[str]],
    stop_words: Set[str],
    normalize_space: Callable[[Any], str],
) -> Sequence[Tuple[str, str]]:
    archetype = infer_query_archetype(
        query,
        supporting_results,
        tokenize=tokenize,
        stop_words=stop_words,
        normalize_space=normalize_space,
    )
    if archetype == "person":
        return PERSON_FALLBACK_FACETS
    if archetype == "impact":
        return IMPACT_FALLBACK_FACETS
    if archetype == "organization":
        return ORGANIZATION_FALLBACK_FACETS
    if archetype == "place":
        return PLACE_FALLBACK_FACETS
    if archetype == "market":
        return MARKET_FALLBACK_FACETS
    if archetype == "technology":
        return TECHNOLOGY_FALLBACK_FACETS
    return generic_facets
