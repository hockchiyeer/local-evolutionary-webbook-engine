"""Cluster-aware organization helpers for chapter assembly."""

import re
from typing import Any, Callable, Dict, List, MutableMapping, Sequence, Set

from .archetypes import infer_query_archetype
from .nlp import semantic_similarity


def _collect_source_terms(
    source: MutableMapping[str, Any],
    *,
    tokenize: Callable[[str], Sequence[str]],
    stop_words: Set[str],
) -> Set[str]:
    terms = set(token for token in tokenize(source.get("title", "")) if token not in stop_words)
    for definition in source.get("definitions", []) or []:
        terms.update(token for token in tokenize(definition.get("term", "")) if token not in stop_words)
    for subtopic in source.get("subTopics", []) or []:
        terms.update(token for token in tokenize(subtopic.get("title", "")) if token not in stop_words)
    content_terms = [token for token in tokenize(source.get("content", "")) if token not in stop_words]
    terms.update(content_terms[:18])
    return terms


def _score_cluster_label(
    text: str,
    *,
    query_focus_words: Set[str],
    tokenize: Callable[[str], Sequence[str]],
    normalize_term_key: Callable[[str], str],
    stop_words: Set[str],
    source_relevance_value: float,
) -> float:
    phrase_key = normalize_term_key(text)
    if not phrase_key:
        return -1.0
    phrase_words = {token for token in tokenize(text) if token not in stop_words}
    if not phrase_words:
        return -1.0

    overlap = len(phrase_words.intersection(query_focus_words)) / max(len(phrase_words), 1)
    specificity = min(len(phrase_words) / 6, 1.0)
    return (overlap * 1.2) + (specificity * 0.35) + (source_relevance_value * 0.55)


def build_source_clusters(
    selected_sources: Sequence[MutableMapping[str, Any]],
    query: str,
    *,
    tokenize: Callable[[str], Sequence[str]],
    query_words: Callable[[str], Set[str]],
    expand_query_focus_words: Callable[[Set[str]], Set[str]],
    normalize_term_key: Callable[[str], str],
    stop_words: Set[str],
    source_relevance: Callable[[MutableMapping[str, Any], Set[str]], float],
) -> List[Dict[str, Any]]:
    q_words = query_words(query)
    focus_words = expand_query_focus_words(q_words)
    clusters: List[Dict[str, Any]] = []

    for source_index, source in enumerate(selected_sources):
        source_terms = _collect_source_terms(source, tokenize=tokenize, stop_words=stop_words)
        source_relevance_value = source_relevance(source, q_words)
        source_title = source.get("title", "")
        source_title_key = normalize_term_key(source_title)

        best_cluster = None
        best_score = 0.0
        for cluster in clusters:
            cluster_terms = cluster["keywords"]
            union = cluster_terms.union(source_terms)
            token_overlap = len(cluster_terms.intersection(source_terms)) / max(len(union), 1)
            label_overlap = 0.18 if source_title_key and source_title_key in cluster["phrase_keys"] else 0.0
            focus_overlap = len(source_terms.intersection(cluster["focus_words"])) / max(len(cluster["focus_words"]), 1)
            semantic_overlap = semantic_similarity(
                f"{source.get('title', '')} {source.get('content', '')[:320]}",
                cluster.get("semantic_text", cluster.get("label", "")),
            )
            score = token_overlap + label_overlap + (focus_overlap * 0.3) + (semantic_overlap * 0.26)
            if score > best_score:
                best_score = score
                best_cluster = cluster

        if best_cluster and best_score >= 0.18:
            cluster = best_cluster
        else:
            cluster = {
                "id": len(clusters),
                "label": "",
                "focus_phrase": "",
                "keywords": set(),
                "focus_words": set(focus_words),
                "phrase_keys": set(),
                "sources": [],
                "source_indices": [],
                "definitions": [],
                "subtopics": [],
                "average_relevance": 0.0,
                "semantic_text": "",
            }
            clusters.append(cluster)

        cluster["keywords"].update(source_terms)
        cluster["sources"].append(source)
        cluster["source_indices"].append(source_index)
        cluster["definitions"].extend(source.get("definitions", []) or [])
        cluster["subtopics"].extend(source.get("subTopics", []) or [])
        cluster["average_relevance"] = (
            sum(source_relevance(item, q_words) for item in cluster["sources"]) / max(len(cluster["sources"]), 1)
        )
        cluster["semantic_text"] = " ".join(
            part
            for part in (
                cluster.get("label", ""),
                " ".join(item.get("title", "") for item in cluster["sources"][:3]),
                " ".join(item.get("term", "") for item in cluster["definitions"][:4]),
                " ".join(item.get("title", "") for item in cluster["subtopics"][:4]),
            )
            if part
        )

        label_candidates = [source.get("title", "")]
        label_candidates.extend(definition.get("term", "") for definition in source.get("definitions", []) or [])
        label_candidates.extend(subtopic.get("title", "") for subtopic in source.get("subTopics", []) or [])

        scored_candidates = []
        for candidate in label_candidates:
            candidate_key = normalize_term_key(candidate)
            if not candidate_key:
                continue
            cluster["phrase_keys"].add(candidate_key)
            scored_candidates.append((
                _score_cluster_label(
                    candidate,
                    query_focus_words=focus_words,
                    tokenize=tokenize,
                    normalize_term_key=normalize_term_key,
                    stop_words=stop_words,
                    source_relevance_value=source_relevance_value,
                ),
                candidate,
            ))

        if scored_candidates:
            scored_candidates.sort(key=lambda item: item[0], reverse=True)
            cluster["label"] = scored_candidates[0][1]
            cluster["focus_phrase"] = cluster["label"]
        elif not cluster["label"]:
            cluster["label"] = source_title
            cluster["focus_phrase"] = source_title

    clusters.sort(
        key=lambda cluster: (
            cluster.get("average_relevance", 0.0),
            len(cluster.get("source_indices", [])),
            len(cluster.get("keywords", [])),
        ),
        reverse=True,
    )
    return clusters


def choose_theme_candidates(
    clusters: Sequence[Dict[str, Any]],
    selected_sources: Sequence[MutableMapping[str, Any]],
    query: str,
    *,
    normalize_term_key: Callable[[str], str],
) -> List[str]:
    candidates = []
    seen = set()

    for cluster in clusters:
        label = cluster.get("label", "")
        label_key = normalize_term_key(label)
        if label and label_key and label_key not in seen and label.lower() != query.lower():
            seen.add(label_key)
            candidates.append(label)

    for source in selected_sources:
        title = source.get("title", "")
        title_key = normalize_term_key(title)
        if title and title_key and title_key not in seen and title.lower() != query.lower():
            seen.add(title_key)
            candidates.append(title)

    return candidates


def select_cluster_for_template(
    clusters: Sequence[Dict[str, Any]],
    template_keywords: Set[str],
    focus_words: Set[str],
    cluster_usage: Dict[int, int],
) -> Dict[str, Any]:
    if not clusters:
        return {}

    scored_clusters = []
    for cluster in clusters:
        cluster_keywords = cluster.get("keywords", set())
        keyword_overlap = len(cluster_keywords.intersection(template_keywords)) / max(len(template_keywords), 1)
        focus_overlap = len(cluster_keywords.intersection(focus_words)) / max(len(focus_words), 1) if focus_words else 0.0
        usage_penalty = cluster_usage.get(cluster["id"], 0) * 0.22
        score = (
            cluster.get("average_relevance", 0.0) * 0.8
            + keyword_overlap * 0.7
            + focus_overlap * 0.35
            + min(len(cluster.get("source_indices", [])) / 3, 1.0) * 0.18
            - usage_penalty
        )
        scored_clusters.append((score, cluster))

    scored_clusters.sort(key=lambda item: item[0], reverse=True)
    return scored_clusters[0][1]


def build_chapter_sentence_pool(
    selected_cluster: Dict[str, Any],
    all_sources: Sequence[MutableMapping[str, Any]],
    q_words: Set[str],
    *,
    extract_sentences: Callable[[str], Sequence[str]],
    tokenize: Callable[[str], Sequence[str]],
    source_relevance: Callable[[MutableMapping[str, Any], Set[str]], float],
) -> List[Dict[str, Any]]:
    sentence_pool = []
    preferred_indexes = set(selected_cluster.get("source_indices", []))
    ordered_indexes = list(preferred_indexes) + [index for index in range(len(all_sources)) if index not in preferred_indexes]

    for position, source_index in enumerate(ordered_indexes):
        source = all_sources[source_index]
        source_focus = source_relevance(source, q_words)
        primary_bonus = 0.16 if source_index in preferred_indexes else 0.0
        fallback_penalty = 0.30 if source.get("_isFallback") else 0.0
        source_quality = max(0.0, (
            source.get("informativeScore", 0.5) * 0.42
            + source.get("authorityScore", 0.5) * 0.20
            + source_focus * 0.38
            + primary_bonus
            - fallback_penalty
        ))
        for sentence_index, sentence in enumerate(extract_sentences(source.get("content", ""))):
            sentence_pool.append({
                "sentence": sentence,
                "words": set(tokenize(sentence)),
                "source_index": source_index,
                "sentence_index": sentence_index,
                "source": source,
                "source_quality": source_quality,
                "cluster_priority": 0 if source_index in preferred_indexes else 1,
                "pool_position": position,
            })

    return sentence_pool


def choose_items_for_chapter(
    items: Sequence[MutableMapping[str, Any]],
    keyword_set: Set[str],
    used_keys: Set[str],
    key_name: str,
    text_getter: Callable[[MutableMapping[str, Any]], str],
    limit: int,
    *,
    tokenize: Callable[[str], Sequence[str]],
    normalize_space: Callable[[Any], str],
) -> List[MutableMapping[str, Any]]:
    scored_items = []
    fallback_items = []

    for item in items:
        key = normalize_space(item.get(key_name, "")).lower()
        if not key:
            continue

        text = normalize_space(text_getter(item))
        overlap = len(set(tokenize(text)).intersection(keyword_set))
        freshness_bonus = 0.3 if key not in used_keys else -0.2
        score = overlap * 1.4 + freshness_bonus + min(len(tokenize(text)) / 25, 0.5)

        if key not in used_keys:
            scored_items.append((score, item))
        fallback_items.append((score, item))

    scored_items.sort(key=lambda entry: entry[0], reverse=True)
    fallback_items.sort(key=lambda entry: entry[0], reverse=True)

    selected = []
    selected_keys = set()

    for _, item in scored_items + fallback_items:
        key = normalize_space(item.get(key_name, "")).lower()
        if key in selected_keys:
            continue
        selected.append(item)
        selected_keys.add(key)
        used_keys.add(key)
        if len(selected) >= limit:
            break

    return selected




def score_sentence(
    sentence: str,
    q_words: Set[str],
    theme_words: Set[str],
    source_quality: float,
    novelty_penalty: float,
    *,
    words: Set[str] | None = None,
) -> float:
    token_set = words or set()
    q_overlap = len(token_set.intersection(q_words)) / max(len(q_words), 1)
    theme_overlap = len(token_set.intersection(theme_words)) / max(len(theme_words), 1)
    detail_bonus = min(len(token_set) / 20, 1.0)

    return (
        (q_overlap * 1.7)
        + (theme_overlap * 1.3)
        + (detail_bonus * 0.4)
        + source_quality
        - novelty_penalty
    )
