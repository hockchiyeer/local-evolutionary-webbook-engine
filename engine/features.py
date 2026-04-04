"""Feature precomputation helpers for selection, frontier ranking, and assembly."""

import re
from typing import Any, Callable, Dict, Iterable, List, MutableMapping, Sequence, Set

from .nlp import semantic_coherence_score


DEFINITIONAL_HINT_PATTERN = re.compile(
    r"\b(is|are|refers to|defined as|means|describes|overview|introduction|fundamentals|basics)\b",
    re.IGNORECASE,
)
LISTICLE_HINT_PATTERN = re.compile(
    r"\b(top\s+\d+|best\s+\d+|reasons|tips|checklist|listicle|ways to)\b",
    re.IGNORECASE,
)
REPEATED_CHAR_PATTERN = re.compile(r"(.)\1{7,}")
LONG_DIGIT_PATTERN = re.compile(r"\d{10,}")
NOISY_ALNUM_PATTERN = re.compile(r"\b(?=[A-Za-z]*\d)(?=\d*[A-Za-z])[A-Za-z0-9]{10,}\b")
SPAM_HINT_TERMS = {
    "click here",
    "buy now",
    "subscribe",
    "sponsored",
    "privacy policy",
    "terms of service",
    "access denied",
    "all rights reserved",
    "cookie policy",
    "advertisement",
}


def _average(values: Sequence[float], default: float = 0.0) -> float:
    values = list(values)
    return (sum(values) / len(values)) if values else default


def _sentence_count(text: str) -> int:
    return len([segment for segment in re.split(r"(?<=[.!?])\s+", text) if segment.strip()])


def _term_overlap(tokens: Sequence[str], focus_words: Set[str]) -> float:
    token_set = set(tokens)
    if not token_set or not focus_words:
        return 0.0
    return len(token_set.intersection(focus_words)) / max(len(focus_words), 1)


def _jaccard(tokens_a: Set[str], tokens_b: Set[str]) -> float:
    if not tokens_a or not tokens_b:
        return 0.0
    union = tokens_a.union(tokens_b)
    return (len(tokens_a.intersection(tokens_b)) / len(union)) if union else 0.0


def _collect_structure_text(result: MutableMapping[str, Any]) -> Dict[str, str]:
    definitions = result.get("definitions", []) or []
    subtopics = result.get("subTopics", []) or []

    definition_text = " ".join(
        f"{item.get('term', '')} {item.get('description', '')}"
        for item in definitions
        if isinstance(item, dict)
    )
    subtopic_text = " ".join(
        f"{item.get('title', '')} {item.get('summary', '')}"
        for item in subtopics
        if isinstance(item, dict)
    )
    return {
        "definition_text": definition_text,
        "subtopic_text": subtopic_text,
    }


def build_quality_feature_snapshot(
    result: MutableMapping[str, Any],
    q_words: Set[str],
    focus_words: Set[str],
    *,
    tokenize: Callable[[str], List[str]],
    normalize_space: Callable[[Any], str],
    source_relevance: Callable[[MutableMapping[str, Any], Set[str]], float],
    clamp: Callable[[float, float, float], float],
) -> Dict[str, float]:
    title = normalize_space(result.get("title", ""))
    content = normalize_space(result.get("content", ""))
    structure_text = _collect_structure_text(result)
    definition_text = normalize_space(structure_text["definition_text"])
    subtopic_text = normalize_space(structure_text["subtopic_text"])

    title_tokens = list(tokenize(title))
    content_tokens = list(tokenize(content))
    definition_tokens = list(tokenize(definition_text))
    subtopic_tokens = list(tokenize(subtopic_text))
    all_tokens = title_tokens + content_tokens + definition_tokens + subtopic_tokens
    all_text = normalize_space(" ".join((title, content, definition_text, subtopic_text)))
    lower_text = all_text.lower()
    unique_ratio = (len(set(all_tokens)) / len(all_tokens)) if all_tokens else 0.0
    sentence_count = _sentence_count(content)

    title_focus_overlap = _term_overlap(title_tokens, focus_words)
    content_focus_overlap = _term_overlap(content_tokens, focus_words)
    definition_focus_overlap = _term_overlap(definition_tokens, focus_words)
    subtopic_focus_overlap = _term_overlap(subtopic_tokens, focus_words)

    definitional_hits = len(DEFINITIONAL_HINT_PATTERN.findall(f"{title}. {content[:700]}"))
    structure_bonus = (
        min(len(result.get("definitions", []) or []), 4) * 0.16
        + min(len(result.get("subTopics", []) or []), 4) * 0.10
    )
    title_bonus = 0.12 if DEFINITIONAL_HINT_PATTERN.search(title) else 0.0
    definitional_density = clamp(
        (definitional_hits * 0.11) + structure_bonus + title_bonus,
        0.0,
        1.0,
    )

    content_depth = clamp(
        min(len(content_tokens) / 280, 1.0) * 0.58
        + min(sentence_count / 7, 1.0) * 0.22
        + min((len(result.get("definitions", []) or []) + len(result.get("subTopics", []) or [])) / 6, 1.0) * 0.20,
        0.0,
        1.0,
    )

    spam_risk = 0.0
    if REPEATED_CHAR_PATTERN.search(all_text):
        spam_risk += 0.24
    if LONG_DIGIT_PATTERN.search(all_text):
        spam_risk += 0.16
    noisy_alnum_hits = len(NOISY_ALNUM_PATTERN.findall(all_text))
    if noisy_alnum_hits:
        spam_risk += min(noisy_alnum_hits * 0.12, 0.24)
    if LISTICLE_HINT_PATTERN.search(title):
        spam_risk += 0.12
    spam_term_hits = sum(1 for term in SPAM_HINT_TERMS if term in lower_text)
    if spam_term_hits:
        spam_risk += min(spam_term_hits * 0.10, 0.25)
    if len(all_tokens) >= 20 and unique_ratio < 0.60:
        spam_risk += min((0.60 - unique_ratio) * 0.85, 0.28)
    if len(content_tokens) < 40 or sentence_count < 2:
        spam_risk += 0.08
    spam_risk = clamp(spam_risk, 0.0, 1.0)

    field_sets = [
        set(title_tokens),
        set(content_tokens),
        set(definition_tokens),
        set(subtopic_tokens),
    ]
    non_empty_fields = [token_set for token_set in field_sets if token_set]
    pairwise_alignments = []
    for index, token_set in enumerate(non_empty_fields):
        for other in non_empty_fields[index + 1:]:
            pairwise_alignments.append(_jaccard(token_set, other))

    internal_alignment = _average(pairwise_alignments, 0.48 if non_empty_fields else 0.0)
    focus_alignment = _average(
        (
            title_focus_overlap,
            content_focus_overlap,
            definition_focus_overlap,
            subtopic_focus_overlap,
        ),
        content_focus_overlap if q_words else 0.5,
    )
    relevance = source_relevance(result, q_words)
    query_text = " ".join(sorted(q_words))
    semantic_alignment = semantic_coherence_score(
        query_text,
        (
            title,
            content,
            definition_text,
            subtopic_text,
        ),
    )
    semantic_coherence = clamp(
        (internal_alignment * 0.32)
        + (focus_alignment * 0.20)
        + (relevance * 0.18)
        + (semantic_alignment * 0.30),
        0.0,
        1.0,
    )

    return {
        "_definitional_density": round(definitional_density, 6),
        "_spam_risk": round(spam_risk, 6),
        "_content_depth": round(content_depth, 6),
        "_semantic_coherence": round(semantic_coherence, 6),
        "_title_focus_overlap": round(title_focus_overlap, 6),
        "_content_focus_overlap": round(content_focus_overlap, 6),
        "_sentence_count": float(sentence_count),
    }


def _normalize_provider(provider_value: Any) -> str:
    if not isinstance(provider_value, str):
        return ""
    return provider_value.strip().lower()


def build_source_feature_snapshot(
    result: MutableMapping[str, Any],
    q_words: Set[str],
    focus_words: Set[str],
    *,
    tokenize: Callable[[str], List[str]],
    normalize_space: Callable[[Any], str],
    source_relevance: Callable[[MutableMapping[str, Any], Set[str]], float],
    extract_concept_keys: Callable[[MutableMapping[str, Any]], Set[str]],
    content_signature_tokens: Callable[[str], Set[str]],
    clamp: Callable[[float, float, float], float],
) -> Dict[str, Any]:
    title = result.get("title", "")
    content = result.get("content", "")
    title_words = set(tokenize(title))
    content_words = set(tokenize(content))
    provider = _normalize_provider(result.get("searchProvider", ""))
    provider_bonus = 0.0

    if provider == "wikipedia":
        provider_bonus = 0.08
    elif provider == "crossref":
        provider_bonus = 0.07
    elif provider == "openlibrary":
        provider_bonus = 0.06
    elif provider == "manual":
        provider_bonus = 0.04
    elif provider in {"google", "bing", "duckduckgo"}:
        provider_bonus = 0.02

    snapshot = {
        "_title_words": title_words,
        "_content_words": content_words,
        "_words": title_words.union(content_words),
        "_relevance": source_relevance(result, q_words),
        "_signature": content_signature_tokens(content),
        "_concept_keys": extract_concept_keys(result),
        "_focus_overlap": (
            len((title_words.union(content_words)).intersection(focus_words)) / max(len(focus_words), 1)
            if focus_words
            else 1.0
        ),
        "_source_trust": round(clamp(float(result.get("authorityScore", 0.5)) + provider_bonus, 0.0, 1.0), 6),
    }
    snapshot.update(
        build_quality_feature_snapshot(
            result,
            q_words,
            focus_words,
            tokenize=tokenize,
            normalize_space=normalize_space,
            source_relevance=source_relevance,
            clamp=clamp,
        )
    )
    return snapshot


def attach_selection_features(
    results: Iterable[MutableMapping[str, Any]],
    q_words: Set[str],
    focus_words: Set[str],
    *,
    tokenize: Callable[[str], List[str]],
    normalize_space: Callable[[Any], str],
    source_relevance: Callable[[MutableMapping[str, Any], Set[str]], float],
    extract_concept_keys: Callable[[MutableMapping[str, Any]], Set[str]],
    content_signature_tokens: Callable[[str], Set[str]],
    clamp: Callable[[float, float, float], float],
) -> None:
    for result in results:
        snapshot = build_source_feature_snapshot(
            result,
            q_words,
            focus_words,
            tokenize=tokenize,
            normalize_space=normalize_space,
            source_relevance=source_relevance,
            extract_concept_keys=extract_concept_keys,
            content_signature_tokens=content_signature_tokens,
            clamp=clamp,
        )
        result.update(snapshot)
