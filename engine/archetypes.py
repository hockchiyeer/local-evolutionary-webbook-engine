"""Generic query-archetype inference for topic-aware fallback and assembly."""

from __future__ import annotations

import re
from difflib import SequenceMatcher
from typing import Any, Callable, Dict, List, Sequence, Set, Tuple


QUESTION_WORDS = {
    "what", "when", "where", "which", "who", "why", "how",
    "can", "could", "should", "would", "will", "may", "might",
}

PERSON_SUPPORT_TERMS = {
    "biography", "biographical", "born", "career", "legacy", "leader", "leadership",
    "politician", "statesman", "prime", "minister", "president", "founder", "author",
    "scientist", "artist", "writer", "actor", "activist", "speech", "government",
    "administration", "office", "cabinet", "reform",
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


def infer_query_archetype(
    query: str,
    supporting_results: Sequence[Dict[str, Any]] = (),
    *,
    tokenize: Callable[[str], Sequence[str]],
    stop_words: Set[str],
    normalize_space: Callable[[Any], str],
) -> str:
    normalized_query = normalize_space(query)
    raw_tokens = _raw_word_tokens(normalized_query)
    lowered_tokens = [token.lower() for token in raw_tokens]
    filtered_tokens = [token for token in lowered_tokens if token not in stop_words]

    if _supports_person_archetype(supporting_results, normalize_space=normalize_space):
        return "person"

    if 2 <= len(raw_tokens) <= 4:
        title_case_ratio = sum(1 for token in raw_tokens if _looks_like_titled_name(token)) / max(len(raw_tokens), 1)
        if (
            title_case_ratio >= 0.66
            and not any(token in QUESTION_WORDS for token in lowered_tokens)
            and not any(token in ORGANIZATION_TERMS for token in lowered_tokens)
            and not any(token in PLACE_TERMS for token in lowered_tokens)
        ):
            return "person"

    if any(token in ORGANIZATION_TERMS for token in filtered_tokens):
        return "organization"
    if any(token in PLACE_TERMS for token in filtered_tokens):
        return "place"
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
    return generic_facets
