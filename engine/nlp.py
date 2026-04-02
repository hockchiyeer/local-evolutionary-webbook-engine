"""Offline semantic helpers backed by local open-source NLP dependencies."""

from __future__ import annotations

from functools import lru_cache
import math
import re
from typing import Any, Iterable, List, Sequence

from .nlp_graph import expand_semantic_phrases

try:
    from sklearn.cluster import AgglomerativeClustering
    from sklearn.decomposition import NMF, TruncatedSVD
    from sklearn.feature_extraction.text import TfidfVectorizer
    from sklearn.metrics.pairwise import cosine_similarity

    SKLEARN_NLP_AVAILABLE = True
except Exception:
    AgglomerativeClustering = None
    NMF = None
    TruncatedSVD = None
    TfidfVectorizer = None
    cosine_similarity = None
    SKLEARN_NLP_AVAILABLE = False


TOKEN_PATTERN = re.compile(r"[a-z0-9']{2,}")


def _normalize_text(text: str) -> str:
    return re.sub(r"\s+", " ", str(text or "")).strip().lower()


def _tokenize(text: str) -> List[str]:
    return TOKEN_PATTERN.findall(_normalize_text(text))


def _average(values: Sequence[float], default: float = 0.0) -> float:
    values = list(values)
    return (sum(values) / len(values)) if values else default


def _clamp(value: float, minimum: float = 0.0, maximum: float = 1.0) -> float:
    return max(minimum, min(maximum, value))


def _fallback_similarity(text_a: str, text_b: str) -> float:
    tokens_a = set(_tokenize(text_a))
    tokens_b = set(_tokenize(text_b))
    if not tokens_a or not tokens_b:
        return 0.0

    token_union = tokens_a.union(tokens_b)
    token_score = (len(tokens_a.intersection(tokens_b)) / len(token_union)) if token_union else 0.0

    char_ngrams_a = {text_a[index:index + 4] for index in range(max(len(text_a) - 3, 0))}
    char_ngrams_b = {text_b[index:index + 4] for index in range(max(len(text_b) - 3, 0))}
    char_union = char_ngrams_a.union(char_ngrams_b)
    char_score = (len(char_ngrams_a.intersection(char_ngrams_b)) / len(char_union)) if char_union else 0.0
    return _clamp((token_score * 0.55) + (char_score * 0.45), 0.0, 1.0)


def _candidate_text(candidate: Any) -> str:
    if isinstance(candidate, str):
        return _normalize_text(candidate)
    if not isinstance(candidate, dict):
        return _normalize_text(str(candidate or ""))

    definitions = candidate.get("definitions", []) or []
    subtopics = candidate.get("subTopics", []) or []
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
    return _normalize_text(
        " ".join(
            part
            for part in (
                candidate.get("title", ""),
                candidate.get("content", ""),
                definition_text,
                subtopic_text,
            )
            if part
        )
    )


@lru_cache(maxsize=4096)
def semantic_similarity(text_a: str, text_b: str) -> float:
    normalized_a = _normalize_text(text_a)
    normalized_b = _normalize_text(text_b)
    if not normalized_a or not normalized_b:
        return 0.0
    if normalized_a == normalized_b:
        return 1.0

    fallback = _fallback_similarity(normalized_a, normalized_b)
    if not SKLEARN_NLP_AVAILABLE:
        return round(fallback, 6)

    scores = [fallback]
    for vectorizer in (
        TfidfVectorizer(stop_words="english", ngram_range=(1, 2), sublinear_tf=True),
        TfidfVectorizer(analyzer="char_wb", ngram_range=(3, 5), sublinear_tf=True),
    ):
        try:
            matrix = vectorizer.fit_transform([normalized_a, normalized_b])
            score = float(cosine_similarity(matrix[0], matrix[1])[0, 0])
            if math.isfinite(score):
                scores.append(score)
        except Exception:
            continue

    return round(_clamp(_average(scores, fallback), 0.0, 1.0), 6)


@lru_cache(maxsize=1024)
def _latent_group_similarity(texts: tuple[str, ...]) -> float:
    normalized_texts = tuple(text for text in (_normalize_text(item) for item in texts) if text)
    if len(normalized_texts) < 3 or not SKLEARN_NLP_AVAILABLE:
        return 0.0

    try:
        matrix = TfidfVectorizer(
            stop_words="english",
            ngram_range=(1, 2),
            sublinear_tf=True,
            min_df=1,
        ).fit_transform(normalized_texts)
        max_components = min(matrix.shape[0] - 1, matrix.shape[1] - 1, 3)
        if max_components < 1:
            return 0.0
        reduced = TruncatedSVD(n_components=max_components, random_state=42).fit_transform(matrix)
        similarity_matrix = cosine_similarity(reduced)
    except Exception:
        return 0.0

    scores = []
    for index in range(len(normalized_texts)):
        for other in range(index + 1, len(normalized_texts)):
            score = float(similarity_matrix[index, other])
            if math.isfinite(score):
                scores.append(score)
    return round(_clamp(_average(scores, 0.0), 0.0, 1.0), 6)


def semantic_coherence_score(query_text: str, text_sections: Iterable[str]) -> float:
    normalized_query = _normalize_text(query_text)
    normalized_sections = [text for text in (_normalize_text(section) for section in text_sections) if text]
    if not normalized_sections:
        return 0.0

    query_scores = [semantic_similarity(normalized_query, section) for section in normalized_sections if normalized_query]
    pairwise_scores = []
    for index, section in enumerate(normalized_sections):
        for other in normalized_sections[index + 1:]:
            pairwise_scores.append(semantic_similarity(section, other))

    latent_score = _latent_group_similarity(tuple([normalized_query] + normalized_sections)) if normalized_query else 0.0
    return round(
        _clamp(
            (_average(query_scores, 0.0) * 0.45)
            + (_average(pairwise_scores, 0.0) * 0.40)
            + (latent_score * 0.15),
            0.0,
            1.0,
        ),
        6,
    )


def _fallback_subtopic_tree(query: str, corpus: Sequence[str], max_topics: int) -> List[dict[str, Any]]:
    query_tokens = set(_tokenize(query))
    candidates: List[dict[str, Any]] = []
    seen_labels = set()

    for phrase in expand_semantic_phrases(query, max_depth=2, limit=max_topics * 3):
        phrase_tokens = [token for token in _tokenize(phrase) if token not in query_tokens]
        if not phrase_tokens:
            continue
        label = " ".join(token.capitalize() for token in phrase_tokens[:3]).strip()
        label_key = label.lower()
        if not label or label_key in seen_labels:
            continue
        seen_labels.add(label_key)
        candidates.append(
            {
                "label": label,
                "keywords": phrase_tokens[:5],
                "branch": len(candidates) % max(1, min(max_topics, 3)),
                "representativeText": phrase,
                "score": round(0.55 + (min(len(phrase_tokens), 3) * 0.08), 6),
                "divergence": round(
                    1.0 - (len(set(phrase_tokens).intersection(query_tokens)) / max(len(set(phrase_tokens)), 1)),
                    6,
                ),
            }
        )
        if len(candidates) >= max_topics:
            return candidates

    for text in corpus:
        tokens = [token for token in _tokenize(text) if token not in query_tokens]
        if len(tokens) < 2:
            continue
        label_tokens = []
        seen_tokens = set()
        for token in tokens:
            if token in seen_tokens:
                continue
            seen_tokens.add(token)
            label_tokens.append(token)
            if len(label_tokens) >= 3:
                break
        label = " ".join(token.capitalize() for token in label_tokens).strip()
        label_key = label.lower()
        if not label or label_key in seen_labels:
            continue
        seen_labels.add(label_key)
        candidates.append(
            {
                "label": label,
                "keywords": label_tokens,
                "branch": len(candidates) % max(1, min(max_topics, 3)),
                "representativeText": text,
                "score": 0.45,
                "divergence": round(
                    1.0 - (len(set(label_tokens).intersection(query_tokens)) / max(len(set(label_tokens)), 1)),
                    6,
                ),
            }
        )
        if len(candidates) >= max_topics:
            break

    return candidates[:max_topics]


def _extract_topic_terms(
    component: Sequence[float],
    feature_names: Sequence[str],
    query_tokens: set[str],
    max_terms: int = 6,
) -> List[str]:
    scored_indices = sorted(range(len(component)), key=lambda index: component[index], reverse=True)
    keywords: List[str] = []
    seen = set()

    for index in scored_indices:
        term = feature_names[index]
        normalized_term = _normalize_text(term)
        term_tokens = [token for token in _tokenize(normalized_term) if token not in seen]
        if not term_tokens:
            continue

        novelty = 1.0 - (len(set(term_tokens).intersection(query_tokens)) / max(len(set(term_tokens)), 1))
        if novelty < 0.15 and len(query_tokens) > 1:
            continue

        for token in term_tokens:
            if token in seen:
                continue
            seen.add(token)
            keywords.append(token)
            if len(keywords) >= max_terms:
                return keywords

    return keywords


def extract_subtopic_tree(query: str, corpus: Iterable[str], max_topics: int = 6) -> List[dict[str, Any]]:
    normalized_query = _normalize_text(query)
    normalized_corpus = [text for text in (_normalize_text(item) for item in corpus) if text]
    if not normalized_query and not normalized_corpus:
        return []

    if len(normalized_corpus) < 2 or not SKLEARN_NLP_AVAILABLE:
        return _fallback_subtopic_tree(normalized_query, normalized_corpus, max_topics)

    try:
        vectorizer = TfidfVectorizer(
            stop_words="english",
            ngram_range=(1, 2),
            sublinear_tf=True,
            min_df=1,
            max_features=2000,
        )
        documents = [normalized_query] + normalized_corpus
        matrix = vectorizer.fit_transform(documents)
        max_components = min(max_topics, matrix.shape[0] - 1, matrix.shape[1] - 1)
        if max_components < 2:
            return _fallback_subtopic_tree(normalized_query, normalized_corpus, max_topics)

        nmf = NMF(
            n_components=max_components,
            init="nndsvda",
            random_state=42,
            max_iter=400,
        )
        topic_matrix = nmf.fit_transform(matrix)
        feature_names = vectorizer.get_feature_names_out()
        query_tokens = set(_tokenize(normalized_query))
        corpus_topic_matrix = topic_matrix[1:]
        raw_topics: List[dict[str, Any]] = []

        for component_index, component in enumerate(nmf.components_):
            keywords = _extract_topic_terms(component, feature_names, query_tokens)
            if not keywords:
                continue

            label_tokens = keywords[:3]
            label = " ".join(token.capitalize() for token in label_tokens).strip()
            if not label:
                continue

            component_weights = corpus_topic_matrix[:, component_index] if corpus_topic_matrix.size else []
            representative_index = int(component_weights.argmax()) if len(component_weights) else 0
            representative_text = (
                normalized_corpus[representative_index]
                if 0 <= representative_index < len(normalized_corpus)
                else normalized_query
            )
            score = float(component_weights.max()) if len(component_weights) else float(topic_matrix[0, component_index])
            divergence = 1.0 - (
                len(set(keywords).intersection(query_tokens)) / max(len(set(keywords)), 1)
            )

            raw_topics.append(
                {
                    "componentId": component_index,
                    "label": label,
                    "keywords": keywords,
                    "representativeText": representative_text,
                    "score": round(score, 6),
                    "divergence": round(_clamp(divergence, 0.0, 1.0), 6),
                    "_vector": list(component),
                }
            )

        if not raw_topics:
            return _fallback_subtopic_tree(normalized_query, normalized_corpus, max_topics)

        unique_topics: List[dict[str, Any]] = []
        seen_labels = set()
        for topic in sorted(raw_topics, key=lambda item: (item["divergence"], item["score"]), reverse=True):
            label_key = topic["label"].lower()
            if label_key in seen_labels:
                continue
            seen_labels.add(label_key)
            unique_topics.append(topic)

        vectors = [topic["_vector"] for topic in unique_topics]
        if AgglomerativeClustering is not None and len(vectors) >= 3:
            branch_count = min(max(2, len(vectors) // 2), len(vectors))
            clustering = AgglomerativeClustering(n_clusters=branch_count)
            cluster_labels = clustering.fit_predict(vectors)
        else:
            cluster_labels = [0] * len(vectors)

        final_topics: List[dict[str, Any]] = []
        for topic, branch in zip(unique_topics[:max_topics], cluster_labels[:max_topics]):
            cleaned = dict(topic)
            cleaned["branch"] = int(branch)
            del cleaned["_vector"]
            final_topics.append(cleaned)

        return final_topics
    except Exception:
        return _fallback_subtopic_tree(normalized_query, normalized_corpus, max_topics)


def semantic_cooccurrence_filter(
    query: str,
    candidates: Sequence[Any],
    *,
    baseline_documents: Sequence[Any] = (),
    min_similarity: float | None = None,
    keep_min: int = 1,
) -> List[Any]:
    prepared = []
    for index, candidate in enumerate(candidates):
        text = _candidate_text(candidate)
        if not text:
            continue
        prepared.append((index, candidate, text))

    if not prepared:
        return list(candidates)

    normalized_query = _normalize_text(query)
    if not normalized_query:
        return [candidate for _, candidate, _ in prepared]

    baseline_texts = [text for text in (_candidate_text(item) for item in baseline_documents) if text]
    threshold = 0.17 if baseline_texts else 0.12
    if min_similarity is not None:
        threshold = min_similarity

    if not SKLEARN_NLP_AVAILABLE:
        scored_items = []
        baseline_weight = 0.35 if baseline_texts else 0.0
        for index, candidate, text in prepared:
            query_score = semantic_similarity(normalized_query, text)
            baseline_score = _average([semantic_similarity(item, text) for item in baseline_texts], query_score)
            score = _clamp((query_score * (1.0 - baseline_weight)) + (baseline_score * baseline_weight), 0.0, 1.0)
            enriched = dict(candidate) if isinstance(candidate, dict) else candidate
            if isinstance(enriched, dict):
                enriched["_semanticCentroidSimilarity"] = round(score, 6)
                enriched["_semanticQuerySimilarity"] = round(query_score, 6)
                enriched["_semanticFilterPassed"] = score >= threshold
            scored_items.append((score, index, enriched))
    else:
        try:
            documents = [normalized_query] + baseline_texts + [text for _, _, text in prepared]
            matrix = TfidfVectorizer(
                stop_words="english",
                ngram_range=(1, 2),
                sublinear_tf=True,
                min_df=1,
                max_features=2500,
            ).fit_transform(documents)
            max_components = min(matrix.shape[0] - 1, matrix.shape[1] - 1, 6)
            if max_components >= 1:
                reduced = TruncatedSVD(n_components=max_components, random_state=42).fit_transform(matrix)
            else:
                reduced = matrix.toarray()

            baseline_count = len(baseline_texts)
            query_vector = reduced[0]
            reference_vectors = reduced[: baseline_count + 1]
            centroid_vector = reference_vectors.mean(axis=0)
            candidate_vectors = reduced[baseline_count + 1:]
            scored_items = []

            for (index, candidate, _text), vector in zip(prepared, candidate_vectors):
                centroid_similarity = float(cosine_similarity([vector], [centroid_vector])[0, 0])
                query_similarity = float(cosine_similarity([vector], [query_vector])[0, 0])
                baseline_similarity = 0.0
                if baseline_count:
                    baseline_similarity = _average(
                        [float(value) for value in cosine_similarity([vector], reference_vectors[1:])[0]],
                        query_similarity,
                    )
                score = _clamp(
                    (centroid_similarity * 0.55)
                    + (query_similarity * 0.30)
                    + (baseline_similarity * 0.15),
                    0.0,
                    1.0,
                )
                enriched = dict(candidate) if isinstance(candidate, dict) else candidate
                if isinstance(enriched, dict):
                    enriched["_semanticCentroidSimilarity"] = round(score, 6)
                    enriched["_semanticQuerySimilarity"] = round(query_similarity, 6)
                    enriched["_semanticFilterPassed"] = score >= threshold
                scored_items.append((score, index, enriched))
        except Exception:
            scored_items = []
            baseline_weight = 0.35 if baseline_texts else 0.0
            for index, candidate, text in prepared:
                query_score = semantic_similarity(normalized_query, text)
                baseline_score = _average([semantic_similarity(item, text) for item in baseline_texts], query_score)
                score = _clamp((query_score * (1.0 - baseline_weight)) + (baseline_score * baseline_weight), 0.0, 1.0)
                enriched = dict(candidate) if isinstance(candidate, dict) else candidate
                if isinstance(enriched, dict):
                    enriched["_semanticCentroidSimilarity"] = round(score, 6)
                    enriched["_semanticQuerySimilarity"] = round(query_score, 6)
                    enriched["_semanticFilterPassed"] = score >= threshold
                scored_items.append((score, index, enriched))

    passed = [(score, index, item) for score, index, item in scored_items if score >= threshold]
    if len(passed) < keep_min:
        scored_items.sort(key=lambda item: (item[0], -item[1]), reverse=True)
        passed = scored_items[: min(len(scored_items), max(keep_min, 1))]

    passed.sort(key=lambda item: item[1])
    return [item for _, _, item in passed]
