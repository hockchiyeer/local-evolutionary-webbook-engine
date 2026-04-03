"""Query-driven fallback query shaping and synthetic source generation."""

import copy
from typing import Any, Callable, Dict, List, Sequence, Set, Tuple

from .archetypes import (
    choose_canonical_topic_label,
    get_fallback_facets,
    infer_query_archetype,
)
from .query_profiles import build_query_profile, query_profile_alignment_score
from .titles import derive_topic_label


GENERIC_FALLBACK_FACETS: Sequence[Tuple[str, str]] = (
    ("Foundations", "core scope, baseline concepts, and the main frame for interpreting the topic"),
    ("Drivers", "forces, incentives, dependencies, and external conditions shaping outcomes"),
    ("Systems", "structures, actors, workflows, and operating models involved in the topic"),
    ("Applications", "practical use cases, deployment contexts, and observed implementation patterns"),
    ("Comparisons", "tradeoffs, competing approaches, and divergent pathways across the topic"),
    ("Constraints", "limits, risks, bottlenecks, and failure modes that complicate execution"),
    ("Evidence", "signals, measurements, indicators, and evidence gaps that matter most"),
    ("Strategy", "decision points, prioritization choices, and near-term strategic implications"),
    ("Implementation", "execution patterns, capability needs, and integration considerations"),
    ("Outlook", "future trajectories, scenario shifts, and the most consequential open questions"),
)

FALLBACK_RESULT_CACHE: Dict[str, List[Dict[str, Any]]] = {}
MAX_FALLBACK_CACHE_ENTRIES = 64
DEFAULT_FALLBACK_WEIGHT = 0.58


PERSON_FACET_SUBTOPICS: Dict[str, Sequence[Tuple[str, str]]] = {
    "Background and Identity": (
        ("Biographical Context", "Core biographical facts, formative influences, and the public identity that frame the person."),
        ("Public Reputation", "How the person is characterized across biographies, speeches, and secondary analysis."),
    ),
    "Career Milestones": (
        ("Institutional Roles", "Major appointments, offices, and institutional roles that shaped the career trajectory."),
        ("Turning Points", "Decisive transitions that changed the scale, direction, or visibility of the person's influence."),
    ),
    "Leadership and Roles": (
        ("Decision Style", "Patterns in leadership, coalition building, executive behavior, or public positioning."),
        ("Power Base", "The institutions, constituencies, or networks that sustained the person's authority."),
    ),
    "Major Contributions": (
        ("Policy or Intellectual Agenda", "Major reforms, ideas, writings, or other enduring contributions attached to the person."),
        ("Implementation Effects", "How those contributions translated into observable institutional or social change."),
    ),
    "Networks and Influence": (
        ("Alliances and Institutions", "The actors, organizations, and alliances that amplified or constrained influence."),
        ("Influence Pathways", "How the person's ideas or decisions traveled through formal and informal networks."),
    ),
    "Public Debate and Criticism": (
        ("Criticism and Opposition", "Main criticisms, rival interpretations, and recurring points of controversy."),
        ("Competing Narratives", "How supporters and critics frame the same decisions in different ways."),
    ),
    "Domestic Impact": (
        ("Institutional Effects", "Effects on governance, policy capacity, or organizational arrangements in the primary setting."),
        ("Social and Economic Outcomes", "Observable consequences for society, industry, or the economy where relevant."),
    ),
    "International Significance": (
        ("Regional Positioning", "How the person's actions affected regional alignments, diplomacy, or external perceptions."),
        ("External Reputation", "How foreign observers, media, or analysts interpret the person's role and significance."),
    ),
    "Legacy": (
        ("Long-Run Effects", "Institutional, ideological, developmental, or cultural effects that outlast the active career."),
        ("Historical Assessment", "How historians and analysts assess the durability and limits of the legacy."),
    ),
    "Contemporary Relevance": (
        ("Present-Day Debates", "Which current debates still invoke the person's record, choices, or example."),
        ("Future Interpretation", "How the subject may be reinterpreted as political, social, or institutional conditions change."),
    ),
}


def _ordered_focus_tokens(query: str, *, tokenize: Callable[[str], Sequence[str]], stop_words: Set[str]) -> List[str]:
    ordered = []
    seen = set()
    for token in tokenize(query):
        if token in stop_words or token in seen:
            continue
        seen.add(token)
        ordered.append(token)
    return ordered


def _derive_anchor_terms(q_words: Set[str], *, max_terms: int = 3) -> List[str]:
    return sorted(q_words, key=lambda token: (-len(token), token))[:max_terms]


def get_fallback_query(
    query: str,
    *,
    tokenize: Callable[[str], Sequence[str]],
    stop_words: Set[str],
    normalize_space: Callable[[Any], str],
) -> str:
    query_profile = build_query_profile(query)
    archetype = infer_query_archetype(
        query,
        (),
        tokenize=tokenize,
        stop_words=stop_words,
        normalize_space=normalize_space,
    )
    if archetype == "person":
        normalized_query = normalize_space(query)
        return normalize_space(f"{normalized_query} biography career legacy")

    words = [w for w in tokenize(query) if w not in stop_words]
    if not words:
        return normalize_space(query)

    filler_words = {
        "best", "considering", "could", "decade", "decades", "high", "most", "next",
        "one", "probable", "response", "should", "value", "year", "years",
    }

    prioritized = []
    seen = set()
    for token in words:
        if len(token) >= 7 and token not in filler_words and token not in seen:
            prioritized.append(token)
            seen.add(token)

    for token in words:
        if token in filler_words or token in seen:
            continue
        prioritized.append(token)
        seen.add(token)

    if len(prioritized) > 6:
        prioritized = prioritized[:6]
    if query_profile.get("fallback_terms"):
        for term in query_profile["fallback_terms"]:
            for token in tokenize(term):
                if token in filler_words or token in seen:
                    continue
                prioritized.append(token)
                seen.add(token)
                if len(prioritized) >= 8:
                    break
            if len(prioritized) >= 8:
                break
    if prioritized:
        return " ".join(prioritized)
    return normalize_space(query)


def results_miss_query_focus(
    query: str,
    results: Sequence[Dict[str, Any]],
    q_words: Set[str],
    *,
    tokenize: Callable[[str], Sequence[str]],
    expand_query_focus_words: Callable[[Set[str]], Set[str]],
) -> bool:
    if not q_words:
        return False

    query_profile = build_query_profile(query)
    focus_terms = expand_query_focus_words(set(q_words))
    anchor_terms = _derive_anchor_terms(set(q_words), max_terms=min(3, max(1, len(q_words))))
    match_count = 0

    for result in results[:10]:
        result_text = (result.get("title", "") + " " + result.get("content", "")).lower()
        result_words = set(tokenize(result_text))
        overlap = result_words.intersection(focus_terms)
        if len(overlap) < max(1, int(len(focus_terms) * 0.2)):
            continue
        if anchor_terms and not result_words.intersection(anchor_terms) and len(focus_terms) > 3:
            continue
        if query_profile.get("name") != "generic":
            if query_profile_alignment_score(result_text, query_profile) <= 0.0:
                continue
        match_count += 1

    return match_count < min(len(results), 3)


def _collect_supporting_phrases(
    query: str,
    supporting_results: Sequence[Dict[str, Any]],
    *,
    tokenize: Callable[[str], Sequence[str]],
    stop_words: Set[str],
    normalize_space: Callable[[Any], str],
    normalize_term_key: Callable[[str], str],
) -> List[str]:
    topic_label = derive_topic_label(query, tokenize=tokenize, stop_words=stop_words)
    candidates = [topic_label, query]

    for result in supporting_results[:8]:
        candidates.append(result.get("title", ""))
        for definition in result.get("definitions", []) or []:
            candidates.append(definition.get("term", ""))
        for subtopic in result.get("subTopics", []) or []:
            candidates.append(subtopic.get("title", ""))

    phrases = []
    seen = set()
    for candidate in candidates:
        phrase = normalize_space(candidate)
        if not phrase:
            continue
        key = normalize_term_key(phrase)
        if not key or key in seen:
            continue
        seen.add(key)
        phrases.append(phrase)

    return phrases


def _clone_results(results: Sequence[Dict[str, Any]]) -> List[Dict[str, Any]]:
    return copy.deepcopy(list(results))


def _build_fallback_cache_key(
    query: str,
    supporting_results: Sequence[Dict[str, Any]],
    *,
    normalize_term_key: Callable[[str], str],
) -> str:
    supporting_keys = []
    for result in supporting_results[:4]:
        title_key = normalize_term_key(result.get("title", ""))
        if title_key:
            supporting_keys.append(title_key)

    return f"{normalize_term_key(query)}::{ '|'.join(supporting_keys) }"


def _build_person_fallback_content(
    topic_label: str,
    query: str,
    facet_label: str,
    facet_description: str,
    evidence_terms: Sequence[str],
    *,
    normalize_space: Callable[[Any], str],
) -> str:
    topic_lower = topic_label.lower()
    query_lower = query.lower()
    clean_anchors = [
        t.capitalize() if t == t.lower() and len(t) <= 14 else t
        for t in evidence_terms
        if t
        and t.lower() != topic_lower
        and t.lower() != query_lower
    ]
    lead       = clean_anchors[0] if clean_anchors else facet_label
    support    = clean_anchors[1] if len(clean_anchors) > 1 else facet_description.split(",")[0]
    additional = clean_anchors[2] if len(clean_anchors) > 2 else query

    return normalize_space(
        f"{topic_label} is a notable public figure whose {facet_label.lower()} has attracted "
        f"significant scholarly and journalistic attention. "
        f"Examining {facet_description} reveals how {lead} and {support} shaped the arc of "
        f"{topic_label}'s public career and historical standing. "
        f"Biographical accounts, institutional records, speeches, and critical analyses of "
        f"{additional} offer complementary perspectives on how {topic_label} exercised influence "
        f"and is assessed by historians. "
        f"The most consequential aspects of {topic_label}'s {facet_label.lower()} include "
        f"documented achievements, key decisions, and the enduring debates over the subject's "
        f"legacy and significance."
    )


def _build_generic_fallback_content(
    topic_label: str,
    query: str,
    facet_label: str,
    facet_description: str,
    evidence_terms: Sequence[str],
    *,
    normalize_space: Callable[[Any], str],
) -> str:
    # Strip anchors that are exact duplicates of the topic label or query so prose
    # doesn't read "shaped by factors such as <full topic> and <full topic>".
    # Individual tokens that happen to appear inside topic_label are kept - they
    # make valid focused anchors (e.g. "Bursa", "solar", "badminton").
    topic_lower = topic_label.lower()
    query_lower = query.lower()
    clean_anchors = [
        t.capitalize() if t == t.lower() and len(t) <= 14 else t
        for t in evidence_terms
        if t
        and t.lower() != topic_lower
        and t.lower() != query_lower
    ]
    lead       = clean_anchors[0] if clean_anchors else facet_label
    support    = clean_anchors[1] if len(clean_anchors) > 1 else topic_label
    additional = clean_anchors[2] if len(clean_anchors) > 2 else query

    return normalize_space(
        f"{topic_label} encompasses important dimensions of {facet_label.lower()}, "
        f"shaped by factors such as {lead} and {support}. "
        f"Researchers and practitioners have studied {topic_label} across multiple contexts, "
        f"applying frameworks drawn from {facet_description} to explain observed variation in outcomes. "
        f"Examining {additional} alongside established models clarifies the tradeoffs, constraints, "
        f"and structural dynamics that define how {topic_label} operates in practice."
    )


def _build_person_fallback_definitions(
    topic_label: str,
    facet_label: str,
    facet_description: str,
    url: str,
) -> List[Dict[str, str]]:
    return [
        {
            "term": topic_label,
            "description": (
                f"{topic_label} is a notable public figure examined here through biography, leadership, public impact, and enduring legacy across institutional and historical contexts."
            ),
            "sourceUrl": url,
        },
        {
            "term": facet_label,
            "description": (
                f"{facet_label} refers to {facet_description}, a key dimension for understanding how {topic_label}'s career and contributions have been documented and interpreted."
            ),
            "sourceUrl": url,
        },
    ]


def _build_person_fallback_subtopics(
    facet_label: str,
    topic_label: str,
    url: str,
) -> List[Dict[str, str]]:
    subtopics = []
    for title, description in PERSON_FACET_SUBTOPICS.get(facet_label, ())[:2]:
        subtopics.append({
            "title": title,
            "summary": f"{description} In this case, the focus remains on {topic_label}.",
            "sourceUrl": url,
        })
    return subtopics


def build_adaptive_fallback_results(
    query: str,
    supporting_results: Sequence[Dict[str, Any]] = (),
    *,
    desired_count: int = 10,
    tokenize: Callable[[str], Sequence[str]],
    stop_words: Set[str],
    normalize_space: Callable[[Any], str],
    normalize_term_key: Callable[[str], str],
    unique_preserve_order: Callable[[Sequence[str]], Sequence[str]],
    build_definition_candidates: Callable[[str, str, str], Sequence[Dict[str, str]]],
    build_subtopic_candidates: Callable[[str, str, str, str], Sequence[Dict[str, str]]],
) -> List[Dict[str, Any]]:
    cache_key = _build_fallback_cache_key(
        query,
        supporting_results,
        normalize_term_key=normalize_term_key,
    )
    if cache_key in FALLBACK_RESULT_CACHE:
        return _clone_results(FALLBACK_RESULT_CACHE[cache_key][:desired_count])

    archetype = infer_query_archetype(
        query,
        supporting_results,
        tokenize=tokenize,
        stop_words=stop_words,
        normalize_space=normalize_space,
    )
    query_profile = build_query_profile(query)
    topic_label = derive_topic_label(query, tokenize=tokenize, stop_words=stop_words) or normalize_space(query)
    canonical_topic_label = choose_canonical_topic_label(
        query,
        supporting_results,
        normalize_space=normalize_space,
    )
    if archetype == "person":
        topic_label = canonical_topic_label or normalize_space(query)
    else:
        topic_label = topic_label or canonical_topic_label or normalize_space(query)

    phrases = _collect_supporting_phrases(
        query,
        supporting_results,
        tokenize=tokenize,
        stop_words=stop_words,
        normalize_space=normalize_space,
        normalize_term_key=normalize_term_key,
    )
    ordered_tokens = _ordered_focus_tokens(query, tokenize=tokenize, stop_words=stop_words)
    evidence_terms = list(unique_preserve_order(phrases + ordered_tokens + query_profile.get("fallback_terms", [])))

    if not evidence_terms:
        evidence_terms = [topic_label or "topic"]

    results = []
    available_facets = list(get_fallback_facets(
        GENERIC_FALLBACK_FACETS,
        query,
        supporting_results,
        tokenize=tokenize,
        stop_words=stop_words,
        normalize_space=normalize_space,
    ))
    fallback_facets = available_facets[:max(1, min(desired_count, len(available_facets)))]

    for index, (facet_label, facet_description) in enumerate(fallback_facets):
        title = f"{facet_label}: {topic_label}".strip(": ")

        rotated_terms = evidence_terms[index:] + evidence_terms[:index]
        if archetype == "person":
            content = _build_person_fallback_content(
                topic_label,
                query,
                facet_label,
                facet_description,
                rotated_terms,
                normalize_space=normalize_space,
            )
        else:
            content = _build_generic_fallback_content(
                topic_label,
                query,
                facet_label,
                facet_description,
                rotated_terms,
                normalize_space=normalize_space,
            )

        url = f"https://knowledge-base.local/adaptive/{index}"
        if archetype == "person":
            definitions = _build_person_fallback_definitions(topic_label, facet_label, facet_description, url)
            subtopics = _build_person_fallback_subtopics(facet_label, topic_label, url)
            if not subtopics:
                subtopics = list(build_subtopic_candidates(title, content, query, url))[:2]
        else:
            definitions = list(build_definition_candidates(title, content, url))[:2]
            subtopics = list(build_subtopic_candidates(title, content, query, url))[:2]

        results.append({
            "url": url,
            "title": title,
            "content": content,
            "definitions": definitions,
            "subTopics": subtopics,
            "searchProvider": "local-synthesis",
            "searchProviders": ["local-synthesis"],
            "_isFallback": True,
            "_fallbackWeight": DEFAULT_FALLBACK_WEIGHT,
            "_fallbackCacheKey": cache_key,
        })

    FALLBACK_RESULT_CACHE[cache_key] = _clone_results(results)
    if len(FALLBACK_RESULT_CACHE) > MAX_FALLBACK_CACHE_ENTRIES:
        oldest_key = next(iter(FALLBACK_RESULT_CACHE))
        del FALLBACK_RESULT_CACHE[oldest_key]

    return _clone_results(results)
