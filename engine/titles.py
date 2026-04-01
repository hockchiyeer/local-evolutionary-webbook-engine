"""Chapter-title synthesis helpers."""

import re
from typing import Any, Callable, Dict, List, Sequence, Set

from .contracts import CHAPTER_TITLE_MAX_CHARS, CHAPTER_TITLE_MAX_WORDS


QUESTION_FILLER_WORDS = {
    "best", "can", "could", "considering", "decade", "decades", "does", "how",
    "might", "most", "next", "over", "probable", "response", "should", "what",
    "which", "who", "why", "would", "year", "years",
}

CHAPTER_TITLE_FALLBACKS = {
    "Foundations": "Scope",
    "Historical Development": "Evolution",
    "Core Concepts": "Key Concepts",
    "Systems and Structures": "Value Chains",
    "Comparative Perspectives": "Approaches",
    "Applications and Use Cases": "Deployment",
    "Challenges and Constraints": "Risks",
    "Measurement and Evidence": "Signals",
    "Strategic Outlook": "Strategic Priorities",
    "Future Directions": "Scenarios",
}


def _soft_overlap_ratio(tokens: Set[str], keywords: Set[str]) -> float:
    if not tokens or not keywords:
        return 0.0

    matched = 0
    for keyword in keywords:
        if keyword in tokens:
            matched += 1
            continue
        if len(keyword) < 5:
            continue
        prefix = keyword[:5]
        if any(len(token) >= 5 and (token.startswith(prefix) or prefix.startswith(token[:5])) for token in tokens):
            matched += 1
    return matched / max(len(keywords), 1)


def _display_token(token: str) -> str:
    if token.isupper() and len(token) <= 5:
        return token
    if len(token) <= 4 and token.upper() == token:
        return token
    if token.lower() in {"ai", "ml", "nlp", "api", "usa", "uk"}:
        return token.upper()
    if token.isdigit():
        return token
    return token.capitalize()


def _trim_title(value: str) -> str:
    value = re.sub(r"\s+", " ", value).strip(" :;,-")
    if len(value) <= CHAPTER_TITLE_MAX_CHARS:
        return value
    shortened = value[:CHAPTER_TITLE_MAX_CHARS].rsplit(" ", 1)[0].strip(" :;,-")
    return shortened or value[:CHAPTER_TITLE_MAX_CHARS].strip(" :;,-")


def _compact_phrase(
    text: str,
    *,
    tokenize: Callable[[str], Sequence[str]],
    stop_words: Set[str],
    max_words: int = CHAPTER_TITLE_MAX_WORDS,
) -> str:
    normalized = re.sub(r"\s+", " ", str(text or "")).strip()
    if not normalized:
        return ""

    normalized = re.split(r"[?!.]", normalized, maxsplit=1)[0]
    normalized = re.split(r"\b(?:and how should|how should|how can|in response)\b", normalized, maxsplit=1, flags=re.IGNORECASE)[0]
    normalized = re.sub(r"\([^)]*\)", " ", normalized)
    normalized = re.sub(r"[\-\u2013\u2014/|]+", " ", normalized)

    original_tokens = re.findall(r"[A-Za-z0-9']+", normalized)
    selected_tokens: List[str] = []
    seen = set()

    for token in original_tokens:
        key = token.lower()
        if key in stop_words or key in QUESTION_FILLER_WORDS:
            continue
        if key in seen:
            continue
        seen.add(key)
        selected_tokens.append(_display_token(token))
        if len(selected_tokens) >= max_words:
            break

    if not selected_tokens:
        fallback_tokens = [token for token in tokenize(normalized) if token not in stop_words][:max_words]
        selected_tokens = [_display_token(token) for token in fallback_tokens]

    return " ".join(selected_tokens).strip()


def derive_topic_label(
    query: str,
    *,
    tokenize: Callable[[str], Sequence[str]],
    stop_words: Set[str],
) -> str:
    return _compact_phrase(query, tokenize=tokenize, stop_words=stop_words, max_words=4)


def build_chapter_title(
    base_label: str,
    query: str,
    focus_phrase: str,
    supporting_sources: Sequence[Dict[str, Any]],
    chapter_definitions: Sequence[Dict[str, Any]],
    chapter_subtopics: Sequence[Dict[str, Any]],
    focus_words: Set[str],
    template_keywords: Set[str],
    *,
    tokenize: Callable[[str], Sequence[str]],
    stop_words: Set[str],
    normalize_term_key: Callable[[str], str],
) -> str:
    query_key = normalize_term_key(query)
    base_key = normalize_term_key(base_label)
    topic_label = derive_topic_label(query, tokenize=tokenize, stop_words=stop_words)
    candidates: List[str] = [focus_phrase]

    candidates.extend(definition.get("term", "") for definition in chapter_definitions)
    candidates.extend(subtopic.get("title", "") for subtopic in chapter_subtopics)

    for source in supporting_sources[:3]:
        candidates.append(source.get("title", ""))
        for definition in (source.get("definitions", []) or [])[:2]:
            candidates.append(definition.get("term", ""))
        for subtopic in (source.get("subTopics", []) or [])[:2]:
            candidates.append(subtopic.get("title", ""))

    scored_candidates = []
    for candidate in candidates:
        compact = _compact_phrase(candidate, tokenize=tokenize, stop_words=stop_words)
        if not compact:
            continue

        raw_candidate_tokens = re.findall(r"[A-Za-z0-9']+", str(candidate or ""))
        filtered_candidate_tokens = [
            token
            for token in raw_candidate_tokens
            if token.lower() not in stop_words and token.lower() not in QUESTION_FILLER_WORDS
        ]
        query_filtered_tokens = [
            token
            for token in filtered_candidate_tokens
            if token.lower() not in focus_words
        ]
        if query_filtered_tokens and len(query_filtered_tokens) < len(filtered_candidate_tokens):
            filtered_compact = " ".join(_display_token(token) for token in query_filtered_tokens[:CHAPTER_TITLE_MAX_WORDS]).strip()
            if filtered_compact:
                compact = filtered_compact

        compact_key = normalize_term_key(compact)
        token_set = set(tokenize(compact))
        if not token_set:
            continue

        overlap_score = (
            _soft_overlap_ratio(token_set, template_keywords) * 1.5
            + (len(token_set.intersection(focus_words)) / max(len(token_set), 1)) * 1.2
            + min(len(token_set) / CHAPTER_TITLE_MAX_WORDS, 1.0) * 0.2
        )
        query_overlap_ratio = len(token_set.intersection(focus_words)) / max(len(token_set), 1)
        overlap_score += (1.0 - query_overlap_ratio) * 0.16

        if compact_key == query_key:
            overlap_score -= 0.5
        if compact_key == base_key:
            overlap_score -= 0.45
        if base_key and compact_key and compact_key in base_key:
            overlap_score -= 0.18
        if candidate.lower().startswith(base_label.lower()) and query_key:
            overlap_score -= 0.38
        if query_overlap_ratio >= 0.34 and len(token_set) > 2:
            overlap_score -= 0.22
        if query_overlap_ratio >= 0.5 and len(token_set) > max(2, len(focus_words)):
            overlap_score -= 0.18

        scored_candidates.append((overlap_score, compact))

    scored_candidates.sort(key=lambda item: item[0], reverse=True)
    for _, compact in scored_candidates:
        if normalize_term_key(compact) == query_key:
            continue
        if normalize_term_key(compact) == base_key:
            continue
        return _trim_title(f"{base_label}: {compact}")

    fallback_tail = CHAPTER_TITLE_FALLBACKS.get(base_label, "")
    if topic_label and fallback_tail:
        return _trim_title(f"{base_label}: {topic_label} {fallback_tail}")
    if topic_label:
        return _trim_title(f"{base_label}: {topic_label}")
    if fallback_tail:
        return _trim_title(f"{base_label}: {fallback_tail}")
    return _trim_title(base_label)
