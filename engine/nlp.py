"""Offline semantic helpers backed by local open-source NLP dependencies."""

from functools import lru_cache
import math
import re
from typing import Iterable, Sequence

try:
    from sklearn.decomposition import TruncatedSVD
    from sklearn.feature_extraction.text import TfidfVectorizer
    from sklearn.metrics.pairwise import cosine_similarity

    SKLEARN_NLP_AVAILABLE = True
except Exception:
    TruncatedSVD = None
    TfidfVectorizer = None
    cosine_similarity = None
    SKLEARN_NLP_AVAILABLE = False


def _normalize_text(text: str) -> str:
    return re.sub(r"\s+", " ", str(text or "")).strip().lower()


def _average(values: Sequence[float], default: float = 0.0) -> float:
    values = list(values)
    return (sum(values) / len(values)) if values else default


def _clamp(value: float, minimum: float = 0.0, maximum: float = 1.0) -> float:
    return max(minimum, min(maximum, value))


def _fallback_similarity(text_a: str, text_b: str) -> float:
    tokens_a = set(re.findall(r"[a-z0-9']{2,}", text_a))
    tokens_b = set(re.findall(r"[a-z0-9']{2,}", text_b))
    if not tokens_a or not tokens_b:
        return 0.0

    token_union = tokens_a.union(tokens_b)
    token_score = (len(tokens_a.intersection(tokens_b)) / len(token_union)) if token_union else 0.0

    char_ngrams_a = {text_a[index:index + 4] for index in range(max(len(text_a) - 3, 0))}
    char_ngrams_b = {text_b[index:index + 4] for index in range(max(len(text_b) - 3, 0))}
    char_union = char_ngrams_a.union(char_ngrams_b)
    char_score = (len(char_ngrams_a.intersection(char_ngrams_b)) / len(char_union)) if char_union else 0.0
    return _clamp((token_score * 0.55) + (char_score * 0.45), 0.0, 1.0)


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
