"""Chapter-title synthesis helpers."""

import re
from typing import Any, Callable, Dict, List, Sequence, Set

from .contracts import CHAPTER_TITLE_MAX_CHARS, CHAPTER_TITLE_MAX_WORDS
from .nlp_graph import concept_crawl_depth, expand_semantic_phrases


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

ROMAN_NUMERAL_PATTERN = re.compile(r"^[ivxlcdm]+$", re.IGNORECASE)
LOW_SIGNAL_TITLE_TOKENS = {
    "article", "articles", "biographical", "biography", "book", "books", "career",
    "careers", "chapter", "chapters", "context", "critical", "epic", "essay",
    "essays", "legacy", "paper", "papers", "part", "program", "programs",
    "report", "reports", "review", "reviews", "study", "studies", "volume",
    "volumes",
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


def _semantic_key(text: str) -> str:
    return re.sub(r"\s+", " ", str(text or "")).strip().lower()


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


def _chapter_depth_target(chapter_index: int, chapter_count: int) -> str:
    if chapter_count <= 1:
        return "seed"
    position = chapter_index / max(chapter_count - 1, 1)
    if position <= 0.25:
        return "seed"
    if position <= 0.7:
        return "related"
    return "tangential"


def _semantic_layer_bonus(layer: str, target_layer: str) -> float:
    if layer == target_layer:
        return 0.24
    if target_layer == "seed" and layer == "related":
        return 0.12
    if target_layer == "related" and layer in {"seed", "tangential"}:
        return 0.08
    if target_layer == "tangential" and layer == "related":
        return 0.12
    return 0.0


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
    semantic_subtopic_tree: Sequence[Dict[str, Any]] = (),
    semantic_title_focus: str = "",
    chapter_index: int = 0,
    chapter_count: int = 10,
    tokenize: Callable[[str], Sequence[str]],
    stop_words: Set[str],
    normalize_term_key: Callable[[str], str],
) -> str:
    query_key = normalize_term_key(query)
    base_key = normalize_term_key(base_label)
    topic_label = derive_topic_label(query, tokenize=tokenize, stop_words=stop_words)
    candidates: List[str] = []
    candidate_bonus_by_key: Dict[str, float] = {}
    target_layer = _chapter_depth_target(chapter_index, chapter_count)
    semantic_focus_key = _semantic_key(semantic_title_focus)

    def add_candidate(value: str, bonus: float = 0.0) -> None:
        if not value:
            return
        candidates.append(value)
        candidate_key = _semantic_key(value)
        if candidate_key:
            candidate_bonus_by_key[candidate_key] = max(candidate_bonus_by_key.get(candidate_key, 0.0), bonus)

    add_candidate(focus_phrase, 0.06)
    if semantic_title_focus:
        add_candidate(semantic_title_focus, 0.18)

    for definition in chapter_definitions:
        add_candidate(definition.get("term", ""), 0.24)
    for subtopic in chapter_subtopics:
        add_candidate(subtopic.get("title", ""), 0.26)
    for topic in semantic_subtopic_tree:
        if isinstance(topic, dict):
            add_candidate(topic.get("label", ""), 0.08)
    for phrase in expand_semantic_phrases(query, max_depth=2, limit=max(6, chapter_count)):
        add_candidate(phrase, 0.04)

    for source in supporting_sources[:3]:
        add_candidate(source.get("title", ""), 0.10)
        for definition in (source.get("definitions", []) or [])[:2]:
            add_candidate(definition.get("term", ""), 0.18)
        for subtopic in (source.get("subTopics", []) or [])[:2]:
            add_candidate(subtopic.get("title", ""), 0.20)

    semantic_bonus_by_key: Dict[str, float] = {}
    for offset, topic in enumerate(semantic_subtopic_tree):
        if not isinstance(topic, dict):
            continue
        label = topic.get("label", "")
        label_key = _semantic_key(label)
        if not label_key:
            continue
        divergence = float(topic.get("divergence", 0.0))
        branch_bonus = max(0.0, 0.20 - (offset * 0.015))
        semantic_bonus_by_key[label_key] = max(
            semantic_bonus_by_key.get(label_key, 0.0),
            branch_bonus + min(divergence * 0.14, 0.14),
        )

    depth_map = {
        _semantic_key(item.get("node", "")): item
        for item in concept_crawl_depth(query, [candidate for candidate in candidates if candidate])
    }

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
        if len(query_filtered_tokens) >= 2 and len(query_filtered_tokens) < len(filtered_candidate_tokens):
            filtered_compact = " ".join(_display_token(token) for token in query_filtered_tokens[:CHAPTER_TITLE_MAX_WORDS]).strip()
            if filtered_compact:
                compact = filtered_compact

        compact_key = normalize_term_key(compact)
        token_set = set(tokenize(compact))
        if not token_set:
            continue

        low_signal_tokens = {
            token
            for token in token_set
            if token in LOW_SIGNAL_TITLE_TOKENS or ROMAN_NUMERAL_PATTERN.fullmatch(token)
        }
        if len(token_set) == 1:
            lone_token = next(iter(token_set))
            if lone_token in LOW_SIGNAL_TITLE_TOKENS or ROMAN_NUMERAL_PATTERN.fullmatch(lone_token) or len(lone_token) <= 2:
                continue
        if low_signal_tokens and len(low_signal_tokens) == len(token_set) and len(token_set) <= 2:
            continue
        non_signal_tokens = token_set.difference(low_signal_tokens)
        if len(token_set) <= 2 and low_signal_tokens and non_signal_tokens and non_signal_tokens.issubset(focus_words):
            continue

        overlap_score = (
            _soft_overlap_ratio(token_set, template_keywords) * 1.5
            + (len(token_set.intersection(focus_words)) / max(len(token_set), 1)) * 1.2
            + min(len(token_set) / CHAPTER_TITLE_MAX_WORDS, 1.0) * 0.2
        )
        query_overlap_ratio = len(token_set.intersection(focus_words)) / max(len(token_set), 1)
        overlap_score += (1.0 - query_overlap_ratio) * 0.16
        if low_signal_tokens:
            overlap_score -= min(0.24 * len(low_signal_tokens), 0.58)
        if len(token_set) == 1:
            overlap_score -= 0.16
        semantic_candidate_key = _semantic_key(candidate)
        overlap_score += candidate_bonus_by_key.get(semantic_candidate_key, 0.0)
        depth_info = depth_map.get(semantic_candidate_key)
        if depth_info:
            overlap_score += _semantic_layer_bonus(str(depth_info.get("layer", "")), target_layer)
        overlap_score += semantic_bonus_by_key.get(semantic_candidate_key, 0.0)
        if semantic_focus_key and semantic_candidate_key == semantic_focus_key:
            overlap_score += 0.42
        if token_set.issubset(focus_words) and len(token_set) <= 3:
            overlap_score -= 0.52
        if query_overlap_ratio >= 0.75 and len(token_set) <= 3:
            overlap_score -= 0.24

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
        if depth_info and depth_info.get("layer") == "seed" and target_layer == "tangential":
            overlap_score -= 0.16
        if depth_info and depth_info.get("layer") == "tangential" and target_layer == "seed":
            overlap_score -= 0.10

        scored_candidates.append((overlap_score, compact))

    scored_candidates.sort(key=lambda item: item[0], reverse=True)
    for _, compact in scored_candidates:
        if normalize_term_key(compact) == query_key:
            continue
        if normalize_term_key(compact) == base_key:
            continue
        return _trim_title(f"{base_label}: {compact}")

    fallback_tail = CHAPTER_TITLE_FALLBACKS.get(base_label, "")
    if semantic_title_focus:
        semantic_tail = _compact_phrase(semantic_title_focus, tokenize=tokenize, stop_words=stop_words)
        if semantic_tail and normalize_term_key(semantic_tail) not in {query_key, base_key}:
            return _trim_title(f"{base_label}: {semantic_tail}")
    if topic_label and fallback_tail:
        return _trim_title(f"{base_label}: {topic_label} {fallback_tail}")
    if topic_label:
        return _trim_title(f"{base_label}: {topic_label}")
    if fallback_tail:
        return _trim_title(f"{base_label}: {fallback_tail}")
    return _trim_title(base_label)
