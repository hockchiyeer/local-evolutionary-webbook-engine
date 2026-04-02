"""Offline query-profile heuristics for event disambiguation and intent shaping."""

from __future__ import annotations

import re
from typing import Any, Dict, Iterable, List, Sequence, Set


TOKEN_PATTERN = re.compile(r"[a-z0-9']{2,}")

IGNORED_TOKENS = {
    "a", "an", "and", "are", "as", "at", "be", "been", "being", "by", "can", "could",
    "did", "do", "does", "for", "from", "how", "if", "in", "into", "is", "it", "its",
    "may", "might", "most", "next", "of", "on", "or", "over", "should", "that", "the",
    "their", "them", "then", "there", "these", "this", "those", "to", "was", "were",
    "what", "when", "where", "which", "who", "why", "will", "with", "would", "year",
    "years", "team", "teams", "win", "winner", "winners", "change", "changes", "come",
    "decade", "decades",
}

PROFILE_SPECS: Sequence[Dict[str, Any]] = (
    {
        "name": "thomas_cup",
        "match_phrases": {"thomas cup"},
        "match_all_tokens": {"thomas", "cup"},
        "required_groups": (
            {"thomas cup", "bwf thomas cup"},
        ),
        "positive_terms": {
            "badminton", "bwf", "thomas cup", "shuttle", "shuttler", "men's team", "team championship",
        },
        "negative_terms": {
            "fifa", "soccer", "football", "icc", "t20", "cricket", "fa cup", "efl", "league cup", "uefa",
        },
        "fallback_terms": ["badminton", "bwf", "men's team championship"],
        "intent_tags": {"sports_event", "winner_prediction"},
    },
    {
        "name": "fifa_world_cup_2026",
        "match_phrases": {"world cup 2026", "2026 world cup", "us world cup"},
        "match_all_tokens": {"world", "cup", "2026"},
        "match_any_tokens": {"us", "usa", "united", "states", "america", "fifa", "soccer", "football"},
        "exclude_tokens": {"icc", "t20", "cricket"},
        "required_groups": (
            {"world cup", "fifa world cup", "2026 fifa world cup"},
            {"fifa", "soccer", "football", "national team", "national teams"},
        ),
        "positive_terms": {
            "fifa", "soccer", "football", "national team", "national teams", "world cup", "usa",
            "united states", "mexico", "canada", "host nations",
        },
        "negative_terms": {
            "icc", "t20", "cricket", "efl", "league cup", "fa cup", "arsenal", "manchester city",
        },
        "fallback_terms": ["fifa", "soccer", "national teams", "usa", "mexico", "canada"],
        "intent_tags": {"sports_event", "winner_prediction"},
    },
    {
        "name": "iran_war_impact",
        "match_phrases": {"iran war", "2026 iran war"},
        "match_all_tokens": {"iran", "war"},
        "required_groups": (
            {"iran", "iranian"},
            {"war", "conflict", "strikes", "military"},
        ),
        "positive_terms": {
            "iran", "iranian", "middle east", "regional security", "oil", "energy", "strait of hormuz",
            "sanctions", "geopolitics", "escalation", "global trade", "security architecture",
        },
        "negative_terms": set(),
        "fallback_terms": ["regional security", "oil", "sanctions", "geopolitics", "middle east"],
        "intent_tags": {"conflict", "impact_forecast"},
    },
)


def _normalize_text(text: str) -> str:
    return re.sub(r"\s+", " ", str(text or "")).strip().lower()


def _tokenize(text: str) -> List[str]:
    return TOKEN_PATTERN.findall(_normalize_text(text))


def _meaningful_tokens(tokens: Iterable[str]) -> List[str]:
    return [token for token in tokens if token not in IGNORED_TOKENS]


def _contains_term(normalized_text: str, token_set: Set[str], term: str) -> bool:
    normalized_term = _normalize_text(term)
    if not normalized_term:
        return False
    if " " in normalized_term:
        return normalized_term in normalized_text
    return normalized_term in token_set


def _extract_anchor_phrases(query: str) -> List[str]:
    tokens = _meaningful_tokens(_tokenize(query))
    phrases: List[str] = []
    seen = set()

    for size in (3, 2):
        for index in range(len(tokens) - size + 1):
            phrase_tokens = tokens[index:index + size]
            if not phrase_tokens:
                continue
            if all(token.isdigit() for token in phrase_tokens):
                continue
            phrase = " ".join(phrase_tokens)
            if phrase in seen:
                continue
            seen.add(phrase)
            phrases.append(phrase)

    return phrases[:6]


def _spec_matches(spec: Dict[str, Any], normalized_query: str, token_set: Set[str]) -> bool:
    match_phrases = spec.get("match_phrases", set()) or set()
    if match_phrases and not any(phrase in normalized_query for phrase in match_phrases):
        if not set(spec.get("match_all_tokens", set()) or set()).issubset(token_set):
            return False

    match_all_tokens = set(spec.get("match_all_tokens", set()) or set())
    if match_all_tokens and not match_all_tokens.issubset(token_set):
        return False

    match_any_tokens = set(spec.get("match_any_tokens", set()) or set())
    if match_any_tokens and not token_set.intersection(match_any_tokens):
        return False

    exclude_tokens = set(spec.get("exclude_tokens", set()) or set())
    if exclude_tokens and token_set.intersection(exclude_tokens):
        return False

    return True


def build_query_profile(query: str) -> Dict[str, Any]:
    normalized_query = _normalize_text(query)
    token_set = set(_tokenize(normalized_query))
    anchor_phrases = _extract_anchor_phrases(normalized_query)
    profile: Dict[str, Any] = {
        "name": "generic",
        "query": normalized_query,
        "anchor_phrases": list(anchor_phrases),
        "required_groups": [],
        "positive_terms": set(),
        "negative_terms": set(),
        "fallback_terms": [],
        "intent_tags": set(),
    }

    for spec in PROFILE_SPECS:
        if not _spec_matches(spec, normalized_query, token_set):
            continue
        profile["name"] = spec["name"]
        profile["required_groups"].extend([set(group) for group in spec.get("required_groups", ())])
        profile["positive_terms"].update(spec.get("positive_terms", set()) or set())
        profile["negative_terms"].update(spec.get("negative_terms", set()) or set())
        profile["fallback_terms"].extend(spec.get("fallback_terms", []) or [])
        profile["intent_tags"].update(spec.get("intent_tags", set()) or set())
        for phrase in spec.get("match_phrases", set()) or set():
            if phrase not in profile["anchor_phrases"]:
                profile["anchor_phrases"].insert(0, phrase)

    deduped_terms = []
    seen = set()
    for term in profile["fallback_terms"]:
        normalized_term = _normalize_text(term)
        if not normalized_term or normalized_term in seen:
            continue
        seen.add(normalized_term)
        deduped_terms.append(term)
    profile["fallback_terms"] = deduped_terms
    return profile


def query_profile_alignment_score(text: str, profile: Dict[str, Any]) -> float:
    normalized_text = _normalize_text(text)
    token_set = set(_tokenize(normalized_text))
    if not normalized_text:
        return -1.0 if profile.get("required_groups") else 0.0

    anchor_hits = sum(1 for phrase in profile.get("anchor_phrases", []) if phrase and phrase in normalized_text)
    positive_hits = sum(1 for term in profile.get("positive_terms", set()) if _contains_term(normalized_text, token_set, term))
    negative_hits = sum(1 for term in profile.get("negative_terms", set()) if _contains_term(normalized_text, token_set, term))

    satisfied_groups = 0
    missing_groups = 0
    for group in profile.get("required_groups", []):
        if any(_contains_term(normalized_text, token_set, term) for term in group):
            satisfied_groups += 1
        else:
            missing_groups += 1

    score = 0.0
    score += min(anchor_hits * 0.16, 0.32)
    score += min(positive_hits * 0.08, 0.32)
    score += satisfied_groups * 0.28
    score -= min(negative_hits * 0.22, 0.66)
    score -= missing_groups * 0.26

    if profile.get("name") != "generic" and not satisfied_groups and profile.get("required_groups"):
        score -= 0.24
    if profile.get("name") == "generic" and anchor_hits:
        score += 0.06

    return max(-1.0, min(1.0, round(score, 6)))
