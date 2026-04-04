"""Normalization helpers for source config and search results."""

from typing import Any, Callable, Dict, MutableMapping, Sequence


def normalize_source_config(
    config: Any,
    *,
    default_source_selection: Dict[str, bool],
    normalize_http_url: Callable[[str], str],
) -> Dict[str, Any]:
    normalized_sources = dict(default_source_selection)
    manual_urls = []
    disable_mock_fallback = False

    if isinstance(config, dict):
        raw_sources = config.get("sources", config)
        if isinstance(raw_sources, dict):
            for key in default_source_selection:
                if key in raw_sources:
                    normalized_sources[key] = bool(raw_sources.get(key))

        raw_manual_urls = config.get("manualUrls", [])
        if isinstance(raw_manual_urls, list):
            for url in raw_manual_urls:
                normalized_url = normalize_http_url(url)
                if normalized_url and normalized_url not in manual_urls:
                    manual_urls.append(normalized_url)

        disable_mock_fallback = bool(config.get("disableMockFallback", False))

    return {
        "sources": normalized_sources,
        "manualUrls": manual_urls[:12],
        "disableMockFallback": disable_mock_fallback,
    }


def normalize_result(
    result: Any,
    query: str,
    fallback_index: int = 0,
    *,
    normalize_space: Callable[[Any], str],
    clamp: Callable[[float, float, float], float],
    build_definition_candidates: Callable[[str, str, str], Sequence[Dict[str, str]]],
    build_subtopic_candidates: Callable[[str, str, str, str], Sequence[Dict[str, str]]],
    normalize_definition: Callable[[Any, str], Any],
    normalize_subtopic: Callable[[Any, str], Any],
    dedupe_definitions: Callable[[Sequence[Dict[str, str]]], Sequence[Dict[str, str]]],
    dedupe_subtopics: Callable[[Sequence[Dict[str, str]]], Sequence[Dict[str, str]]],
    estimate_informative_score: Callable[[str, str, Sequence[Dict[str, str]], Sequence[Dict[str, str]]], float],
    estimate_authority_score: Callable[[str, str, str], float],
) -> Dict[str, Any]:
    if not isinstance(result, dict):
        result = {}

    title = normalize_space(result.get("title", "")) or f"{query} Reference {fallback_index + 1}"
    url = normalize_space(result.get("url", "")) or f"https://knowledge-base.local/source/{fallback_index}"
    content = normalize_space(result.get("content", "")) or f"No detailed content was found for {query}."

    definitions = [
        normalized
        for normalized in (
            normalize_definition(item, url) for item in result.get("definitions", []) or []
        )
        if normalized
    ]
    subtopics = [
        normalized
        for normalized in (
            normalize_subtopic(item, url) for item in result.get("subTopics", []) or []
        )
        if normalized
    ]

    if not definitions:
        definitions = list(build_definition_candidates(title, content, url))
    if not subtopics:
        subtopics = list(build_subtopic_candidates(title, content, query, url))

    definitions = list(dedupe_definitions(definitions))[:6]
    subtopics = list(dedupe_subtopics(subtopics))[:4]

    informative_score = result.get("informativeScore")
    if not isinstance(informative_score, (int, float)):
        informative_score = estimate_informative_score(content, query, definitions, subtopics)
    informative_score = round(clamp(float(informative_score), 0.0, 1.0), 4)

    authority_score = result.get("authorityScore")
    if not isinstance(authority_score, (int, float)):
        authority_score = estimate_authority_score(url, content, title)
    authority_score = round(clamp(float(authority_score), 0.0, 1.0), 4)

    search_provider = normalize_space(result.get("searchProvider", "")).lower()
    raw_search_providers = result.get("searchProviders", [])
    search_providers = []
    if isinstance(raw_search_providers, list):
        for provider in raw_search_providers:
            normalized_provider = normalize_space(provider).lower()
            if normalized_provider and normalized_provider not in search_providers:
                search_providers.append(normalized_provider)
    if search_provider and search_provider not in search_providers:
        search_providers.append(search_provider)

    normalized_result = {
        "url": url,
        "title": title,
        "content": content[:3200],
        "informativeScore": informative_score,
        "authorityScore": authority_score,
        "definitions": definitions,
        "subTopics": subtopics,
        "fitness": round(
            clamp(
                float(result.get("fitness", 0)) if isinstance(result.get("fitness", 0), (int, float)) else 0.0,
                0.0,
                1.0,
            ),
            4,
        ),
        "searchProvider": search_provider,
        "searchProviders": search_providers,
    }

    for key in (
        "_words",
        "_relevance",
        "_signature",
        "_concept_keys",
        "_title_words",
        "_content_words",
        "_focus_overlap",
        "_source_trust",
        "_definitional_density",
        "_spam_risk",
        "_content_depth",
        "_semantic_coherence",
        "_title_focus_overlap",
        "_content_focus_overlap",
        "_sentence_count",
        "_frontierScore",
        "_isFallback",
        "_fallbackWeight",
        "_fallbackCacheKey",
    ):
        if key in result:
            normalized_result[key] = result[key]

    return normalized_result


def dedupe_results(
    results: Sequence[MutableMapping[str, Any]],
    query: str,
    *,
    normalize_result_fn: Callable[[Any, str, int], Dict[str, Any]],
    unique_preserve_order: Callable[[Sequence[str]], Sequence[str]],
    dedupe_definitions: Callable[[Sequence[Dict[str, str]]], Sequence[Dict[str, str]]],
    dedupe_subtopics: Callable[[Sequence[Dict[str, str]]], Sequence[Dict[str, str]]],
) -> Sequence[Dict[str, Any]]:
    deduped = []
    seen_lookup = {}

    for index, result in enumerate(results or []):
        normalized = normalize_result_fn(result, query, index)
        url_key = normalized["url"].lower()
        title_key = normalized["title"].lower()
        existing_index = seen_lookup.get(url_key)
        if existing_index is None:
            existing_index = seen_lookup.get(title_key)

        if existing_index is not None:
            existing = deduped[existing_index]
            merged_providers = unique_preserve_order(
                (existing.get("searchProviders", []) or []) + (normalized.get("searchProviders", []) or [])
            )
            existing["searchProviders"] = list(merged_providers)
            if not existing.get("searchProvider") and normalized.get("searchProvider"):
                existing["searchProvider"] = normalized.get("searchProvider")
            if len(normalized.get("content", "")) > len(existing.get("content", "")):
                existing["content"] = normalized["content"]
            existing["definitions"] = list(
                dedupe_definitions((existing.get("definitions", []) or []) + (normalized.get("definitions", []) or []))
            )[:6]
            existing["subTopics"] = list(
                dedupe_subtopics((existing.get("subTopics", []) or []) + (normalized.get("subTopics", []) or []))
            )[:4]
            existing["informativeScore"] = max(existing.get("informativeScore", 0.0), normalized.get("informativeScore", 0.0))
            existing["authorityScore"] = max(existing.get("authorityScore", 0.0), normalized.get("authorityScore", 0.0))
            for key in (
                "_words",
                "_relevance",
                "_signature",
                "_concept_keys",
                "_title_words",
                "_content_words",
                "_focus_overlap",
                "_source_trust",
                "_definitional_density",
                "_spam_risk",
                "_content_depth",
                "_semantic_coherence",
                "_title_focus_overlap",
                "_content_focus_overlap",
                "_sentence_count",
                "_frontierScore",
                "_isFallback",
                "_fallbackWeight",
                "_fallbackCacheKey",
            ):
                if key not in existing and key in normalized:
                    existing[key] = normalized[key]
            continue

        seen_lookup[url_key] = len(deduped)
        seen_lookup[title_key] = len(deduped)
        deduped.append(normalized)

    return deduped
