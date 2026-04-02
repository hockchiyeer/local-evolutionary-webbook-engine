import sys
import json
import random
import time
import urllib.parse
import re
import contextlib
from functools import lru_cache

from engine.features import attach_selection_features
from engine.fallback import (
    build_adaptive_fallback_results as build_adaptive_fallback_results_impl,
    get_fallback_query as get_fallback_query_impl,
    results_miss_query_focus as results_miss_query_focus_impl,
)
from engine.fitness import calculate_selection_fitness
from engine.ga import (
    crossover as ga_crossover,
    ensure_target_size as ga_ensure_target_size,
    evolve_population,
    greedy_seed_indices as ga_greedy_seed_indices,
    mutate as ga_mutate,
    tournament_pick as ga_tournament_pick,
)
from engine.nlp import extract_subtopic_tree, semantic_similarity
from engine.nlp_graph import concept_crawl_depth, expand_semantic_phrases, expand_semantic_terms
from engine.archetypes import get_chapter_templates
from engine.normalize import (
    dedupe_results as dedupe_results_impl,
    normalize_result as normalize_result_impl,
    normalize_source_config as normalize_source_config_impl,
)
from engine.organize import (
    build_chapter_sentence_pool,
    build_fallback_paragraph as build_fallback_paragraph_impl,
    build_source_clusters,
    choose_items_for_chapter as choose_items_for_chapter_impl,
    choose_theme_candidates as choose_theme_candidates_impl,
    score_sentence as score_sentence_impl,
    select_cluster_for_template,
)
from engine.search import (
    build_search_headers,
    fetch_page_document as fetch_page_document_impl,
    fetch_page_excerpt as fetch_page_excerpt_impl,
    fetch_manual_sources as fetch_manual_sources_impl,
    interleave_result_lists as interleave_result_lists_impl,
    normalize_http_url as normalize_http_url_impl,
    run_provider_searches,
    search_bing as search_bing_impl,
    search_duckduckgo as search_duckduckgo_impl,
    search_google as search_google_impl,
    search_wikipedia as search_wikipedia_impl,
    search_web_results,
)
from engine.titles import build_chapter_title

POISON_KEYWORDS = [
    "copyright",
    "rights reserved",
    "terms of service",
    "privacy policy",
    "unauthorized access",
    "cybersecurity",
    "protected by",
    "cookie policy",
    "scrapping",
    "bot detection",
    "access denied",
    "legal notice",
    "disclaimer",
    "all rights",
    "terms of use",
    "security warning",
    "intellectual property",
    "proprietary information",
    "confidentiality",
]

STOP_WORDS = {
    "a", "an", "and", "are", "as", "at", "be", "been", "being", "by", "for", "from",
    "how", "in", "into", "is", "it", "its", "of", "on", "or", "that", "the", "their",
    "this", "to", "was", "were", "what", "when", "where", "which", "with", "within",
    "about", "across", "after", "also", "among", "between", "during", "over", "under",
    "than", "then", "them", "these", "those", "through", "toward", "towards", "via",
}

ENTITY_VERB_PATTERN = re.compile(
    r"^([A-Z][A-Za-z0-9][A-Za-z0-9\s&/\-(),]{2,80}?)\s+"
    r"(?:is|are|was|were|refers to|describes|means|represents)\s+.+"
)

CHAPTER_TEMPLATES = [
    ("Foundations", {"foundation", "definition", "overview", "origin"}),
    ("Historical Development", {"history", "origin", "timeline", "development"}),
    ("Core Concepts", {"core", "mechanism", "concept", "principle"}),
    ("Systems and Structures", {"system", "structure", "organization", "model"}),
    ("Comparative Perspectives", {"comparison", "variant", "difference", "tradeoff"}),
    ("Applications and Use Cases", {"application", "practice", "use", "deployment"}),
    ("Challenges and Constraints", {"challenge", "constraint", "risk", "limitation"}),
    ("Measurement and Evidence", {"metric", "measurement", "evidence", "evaluation"}),
    ("Strategic Outlook", {"strategy", "impact", "decision", "outlook"}),
    ("Future Directions", {"future", "trend", "innovation", "projection"}),
]

DEFAULT_SOURCE_SELECTION = {
    "wikipedia": True,
    "duckduckgo": False,
    "google": False,
    "bing": False,
}

USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:123.0) Gecko/20100101 Firefox/123.0',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:123.0) Gecko/20100101 Firefox/123.0',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Edge/122.0.0.0',
]

SEARCH_REQUEST_TIMEOUT = 15
PAGE_FETCH_TIMEOUT = 8

def normalize_space(text):
    return re.sub(r"\s+", " ", str(text or "")).strip()


def tokenize(text):
    return re.findall(r"[A-Za-z0-9']{2,}", normalize_space(text).lower())


def clamp(value, lower=0.0, upper=1.0):
    return max(lower, min(upper, value))


def average(values, default=0.0):
    values = list(values)
    return (sum(values) / len(values)) if values else default


def unique_preserve_order(items):
    seen = set()
    ordered = []
    for item in items:
        if item in seen:
            continue
        seen.add(item)
        ordered.append(item)
    return ordered


def is_meaningful_text(text, description=""):
    normalized_text = normalize_space(text)
    normalized_description = normalize_space(description)
    if not normalized_text:
        return False

    clean = re.sub(r"\s+", "", normalized_text)
    lower_text = normalized_text.lower()
    lower_desc = normalized_description.lower()

    if clean.isdigit():
        return False
    if re.search(r"(.)\1{8,}", clean):
        return False
    if re.search(r"\d{10,}", clean):
        return False
    if len(normalized_text) > 40 and " " not in normalized_text:
        return False
    if len(clean) > 12 and not re.search(r"[aeiou]", clean, re.IGNORECASE):
        return False
    if re.search(r"(.{4,})\1{2,}", clean):
        return False
    if any(keyword in lower_text or keyword in lower_desc for keyword in POISON_KEYWORDS):
        return False

    words = [word for word in (lower_text + " " + lower_desc).split() if word]
    if len(words) > 30 and (len(set(words)) / len(words)) < 0.35:
        return False

    if re.search(r"\b(mov|push|pop|jmp|call|ret|int|add|sub|xor|nop|lea|cmp)\b", normalized_text, re.IGNORECASE):
        return False
    if re.search(r"\b(mov|push|pop|jmp|call|ret|int|add|sub|xor|nop|lea|cmp)\b", normalized_description, re.IGNORECASE):
        return False
    if re.search(r"[0-9a-f]{2,}\s[0-9a-f]{2,}\s[0-9a-f]{2,}", normalized_text, re.IGNORECASE):
        return False

    return True


def normalize_definition(item, fallback_source_url=""):
    if not isinstance(item, dict):
        return None

    term = normalize_space(item.get("term", ""))
    description = normalize_space(item.get("description", ""))
    source_url = normalize_space(item.get("sourceUrl") or fallback_source_url)
    if not term or not description or not is_meaningful_text(term, description):
        return None

    return {
        "term": term,
        "description": description,
        "sourceUrl": source_url,
    }


def normalize_subtopic(item, fallback_source_url=""):
    if not isinstance(item, dict):
        return None

    title = normalize_space(item.get("title", ""))
    summary = normalize_space(item.get("summary", ""))
    source_url = normalize_space(item.get("sourceUrl") or fallback_source_url)
    if not title or not summary or not is_meaningful_text(title, summary):
        return None

    return {
        "title": title,
        "summary": summary,
        "sourceUrl": source_url,
    }


def dedupe_definitions(definitions):
    seen_terms = set()
    deduped = []
    for definition in definitions:
        key = normalize_space(definition.get("term", "")).lower()
        if not key or key in seen_terms:
            continue
        seen_terms.add(key)
        deduped.append(definition)
    return deduped


def dedupe_subtopics(subtopics):
    seen_titles = set()
    deduped = []
    for subtopic in subtopics:
        key = normalize_space(subtopic.get("title", "")).lower()
        if not key or key in seen_titles:
            continue
        seen_titles.add(key)
        deduped.append(subtopic)
    return deduped


def normalize_term_key(text):
    tokens = [token for token in tokenize(text) if token not in STOP_WORDS]
    return " ".join(tokens[:6]).strip()


def query_words(query):
    return {token for token in tokenize(query) if token not in STOP_WORDS}


def _generic_token_variants(token):
    variants = {token}
    if len(token) <= 3:
        return variants

    if token.endswith("ies") and len(token) > 4:
        variants.add(token[:-3] + "y")
    if token.endswith("es") and len(token) > 4:
        variants.add(token[:-2])
    if token.endswith("s") and len(token) > 3 and not token.endswith("ss"):
        variants.add(token[:-1])
    if token.endswith("y") and len(token) > 3:
        variants.add(token[:-1] + "ies")
    if token.endswith("ian") and len(token) > 5:
        variants.add(token[:-3] + "ia")
    if token.endswith("ia") and len(token) > 4:
        variants.add(token[:-2] + "ian")
    if token.endswith("ing") and len(token) > 5:
        variants.add(token[:-3])
        variants.add(token[:-3] + "e")
    if token.endswith("ed") and len(token) > 4:
        variants.add(token[:-2])

    return {variant for variant in variants if len(variant) >= 2}


def expand_query_focus_words(q_words):
    expanded = set()
    for token in q_words:
        expanded.update(_generic_token_variants(token))
    return expanded


@lru_cache(maxsize=256)
def semantic_query_terms(query_signature):
    terms = set(expand_semantic_terms(query_signature, max_depth=1, limit=24))
    return {term for term in terms if term not in STOP_WORDS}


def chapter_depth_target(chapter_index, chapter_count):
    if chapter_count <= 1:
        return "seed"
    position = chapter_index / max(chapter_count - 1, 1)
    if position <= 0.25:
        return "seed"
    if position <= 0.7:
        return "related"
    return "tangential"


def build_semantic_title_path(query, semantic_topics, theme_candidates, chapter_count):
    ordered_topics = sorted(
        [topic for topic in semantic_topics if isinstance(topic, dict)],
        key=lambda item: (float(item.get("divergence", 0.0)), float(item.get("score", 0.0))),
        reverse=True,
    )
    candidate_phrases = unique_preserve_order(
        [
            topic.get("label", "")
            for topic in ordered_topics
        ] + list(theme_candidates) + expand_semantic_phrases(query, max_depth=2, limit=max(8, chapter_count))
    )
    candidate_phrases = [phrase for phrase in candidate_phrases if normalize_space(phrase)]
    if not candidate_phrases:
        return [query for _ in range(chapter_count)]

    depth_groups = {"seed": [], "related": [], "tangential": []}
    for item in concept_crawl_depth(query, candidate_phrases):
        layer = item.get("layer", "related")
        depth_groups.setdefault(layer, []).append(item.get("node", query))

    path = []
    for chapter_index in range(chapter_count):
        target_layer = chapter_depth_target(chapter_index, chapter_count)
        pool = (
            depth_groups.get(target_layer)
            or depth_groups.get("related")
            or depth_groups.get("seed")
            or candidate_phrases
        )
        path.append(pool[chapter_index % len(pool)])
    return path


def normalize_source_config(config):
    return normalize_source_config_impl(
        config,
        default_source_selection=DEFAULT_SOURCE_SELECTION,
        normalize_http_url=normalize_http_url,
    )


def title_from_sentence(sentence, query):
    fragment = normalize_space(re.split(r"[:;,-]", sentence)[0])
    q_words = query_words(query)
    words = [
        word for word in re.findall(r"[A-Za-z][A-Za-z'-]{2,}", fragment)
        if word.lower() not in STOP_WORDS and word.lower() not in q_words
    ]
    if len(words) < 2:
        return ""

    title = " ".join(word.capitalize() for word in words[:5])
    return title if is_meaningful_text(title, sentence) else ""


def build_definition_candidates(title, content, source_url):
    sentences = extract_sentences(content)
    definitions = []
    seen_terms = set()

    def add_candidate(term, description):
        normalized_term = normalize_space(term)
        normalized_description = normalize_space(description)
        key = normalized_term.lower()
        if not normalized_term or key in seen_terms:
            return
        if not is_meaningful_text(normalized_term, normalized_description):
            return

        seen_terms.add(key)
        definitions.append({
            "term": normalized_term,
            "description": normalized_description,
            "sourceUrl": source_url,
        })

    if title and sentences:
        add_candidate(title, sentences[0])

    for sentence in sentences[:8]:
        match = ENTITY_VERB_PATTERN.match(sentence)
        if match:
            candidate_term = normalize_space(match.group(1))
            candidate_tokens = tokenize(candidate_term)
            if 1 <= len(candidate_tokens) <= 8:
                add_candidate(candidate_term, sentence)
        if len(definitions) >= 6:
            break

    return definitions[:6]


def build_subtopic_candidates(title, content, query, source_url):
    sentences = extract_sentences(content)
    q_words = query_words(query)
    focus_words = expand_query_focus_words(q_words)
    scored_sentences = []

    for sentence in sentences[1:10]:
        sentence_words = set(tokenize(sentence))
        if len(sentence_words) < 6:
            continue

        overlap = len(sentence_words.intersection(focus_words)) / max(len(focus_words), 1)
        detail_score = min(len(sentence_words) / 22, 1.0)
        scored_sentences.append((overlap * 1.3 + detail_score, sentence))

    scored_sentences.sort(key=lambda item: item[0], reverse=True)

    subtopics = []
    seen_titles = set()
    for _, sentence in scored_sentences:
        candidate_title = title_from_sentence(sentence, query)
        if not candidate_title:
            continue

        key = candidate_title.lower()
        if key in seen_titles:
            continue

        seen_titles.add(key)
        subtopics.append({
            "title": candidate_title,
            "summary": normalize_space(sentence),
            "sourceUrl": source_url,
        })
        if len(subtopics) >= 4:
            break

    if not subtopics and title and sentences:
        fallback_title = f"Context for {title}"
        if is_meaningful_text(fallback_title, sentences[0]):
            subtopics.append({
                "title": fallback_title,
                "summary": sentences[0],
                "sourceUrl": source_url,
            })

    return subtopics[:4]


def estimate_informative_score(content, query, definitions, subtopics):
    words = tokenize(content)
    sentences = extract_sentences(content)
    q_words = query_words(query)
    focus_words = expand_query_focus_words(q_words)
    
    # Base overlap
    overlap = len(set(words).intersection(focus_words)) / max(len(focus_words), 1)
    
    # Key concept matching
    query_concepts = extract_key_concepts(query)
    content_concepts = extract_key_concepts(content)
    concept_overlap = 0.0
    if query_concepts:
        concept_overlap = len(content_concepts.intersection(query_concepts)) / len(query_concepts)
    
    length_score = min(len(words) / 260, 1.0)
    sentence_score = min(len(sentences) / 6, 1.0)
    structure_score = min((len(definitions) * 0.14) + (len(subtopics) * 0.16), 1.0)

    # Re-weighting to include concept overlap
    score = (length_score * 0.25) + (overlap * 0.25) + (concept_overlap * 0.20) + (sentence_score * 0.15) + (structure_score * 0.15)
    return round(clamp(score, 0.35, 0.98), 4)


def estimate_authority_score(url, content, title):
    host = urllib.parse.urlparse(url).netloc.lower()
    score = 0.48

    if "wikipedia.org" in host:
        score += 0.38
    elif host.endswith(".gov"):
        score += 0.28
    elif host.endswith(".edu"):
        score += 0.24
    elif host.endswith(".org"):
        score += 0.16
    elif host.endswith(".com"):
        score += 0.10

    if len(extract_sentences(content)) >= 4:
        score += 0.05
    if len(tokenize(title)) >= 2:
        score += 0.03

    return round(clamp(score, 0.40, 0.99), 4)


def normalize_result(result, query, fallback_index=0):
    return normalize_result_impl(
        result,
        query,
        fallback_index,
        normalize_space=normalize_space,
        clamp=clamp,
        build_definition_candidates=build_definition_candidates,
        build_subtopic_candidates=build_subtopic_candidates,
        normalize_definition=normalize_definition,
        normalize_subtopic=normalize_subtopic,
        dedupe_definitions=dedupe_definitions,
        dedupe_subtopics=dedupe_subtopics,
        estimate_informative_score=estimate_informative_score,
        estimate_authority_score=estimate_authority_score,
    )


def dedupe_results(results, query):
    return dedupe_results_impl(
        results,
        query,
        normalize_result_fn=normalize_result,
        unique_preserve_order=unique_preserve_order,
        dedupe_definitions=dedupe_definitions,
        dedupe_subtopics=dedupe_subtopics,
    )


def content_signature_tokens(text):
    return {token for token in tokenize(text) if token not in STOP_WORDS}


def jaccard_similarity(tokens_a, tokens_b):
    if not tokens_a or not tokens_b:
        return 0.0
    if tokens_a is tokens_b:
        return 1.0
    union = tokens_a.union(tokens_b)
    return (len(tokens_a.intersection(tokens_b)) / len(union)) if union else 0.0


def extract_concept_keys(result):
    if "_concept_keys" in result:
        return result["_concept_keys"]
    keys = set()
    for definition in result.get("definitions", []) or []:
        key = normalize_term_key(definition.get("term", ""))
        if key:
            keys.add(key)
    for subtopic in result.get("subTopics", []) or []:
        key = normalize_term_key(subtopic.get("title", ""))
        if key:
            keys.add(key)
    return keys


def extract_key_concepts(text):
    """
    Extracts potentially important concepts from text.
    Focuses on capitalized words (proper nouns) and longer words.
    """
    # Find words that start with a capital letter (but aren't at the start of a sentence)
    # This is a very rough heuristic for proper nouns in English.
    proper_nouns = re.findall(r"(?<![.!?]\s)\b[A-Z][a-z]{2,}\b", text)
    
    # Also find long words that might be technical terms
    long_words = [w for w in tokenize(text) if len(w) > 8 and w not in STOP_WORDS]
    
    return set(proper_nouns).union(set(long_words))


def source_relevance(result, q_words):
    if "_relevance" in result:
        return result["_relevance"]
    if not q_words:
        return 0.5

    def soft_match(term, token_set):
        if term in token_set:
            return True
        if len(term) < 6:
            return False
        prefix = term[:5]
        for token in token_set:
            if len(token) >= 5 and (token.startswith(prefix) or prefix.startswith(token[:5])):
                return True
        return False

    title = result.get("title", "").lower()
    content = result.get("content", "").lower()
    focus_words = expand_query_focus_words(q_words)
    query_signature = " ".join(sorted(q_words))
    semantic_focus_words = semantic_query_terms(query_signature)
    
    # Base overlap score
    result_text = title + " " + content
    result_words = set(tokenize(result_text))
    title_words = set(tokenize(title))
    content_words = set(tokenize(content))
    
    # Weighted overlap: title words are worth more
    title_overlap = len(title_words.intersection(focus_words)) / max(len(focus_words), 1)
    content_overlap = len(content_words.intersection(focus_words)) / max(len(focus_words), 1)
    semantic_title_overlap = (
        len(title_words.intersection(semantic_focus_words)) / max(len(semantic_focus_words), 1)
        if semantic_focus_words else 0.0
    )
    semantic_content_overlap = (
        len(content_words.intersection(semantic_focus_words)) / max(len(semantic_focus_words), 1)
        if semantic_focus_words else 0.0
    )
    semantic_overlap = (semantic_title_overlap * 0.55) + (semantic_content_overlap * 0.45)
    overlap = (title_overlap * 0.46) + (content_overlap * 0.30) + (semantic_overlap * 0.24)
    latent_similarity = clamp(
        float(
            result.get(
                "_semanticCentroidSimilarity",
                result.get("_semanticQuerySimilarity", semantic_similarity(query_signature, result_text)),
            )
        ),
        0.0,
        1.0,
    )

    filler_terms = {
        "best", "can", "considering", "could", "decade", "decades", "how", "most",
        "next", "one", "probable", "response", "should", "what", "year", "years",
    }
    anchor_terms = [
        token for token in sorted(q_words, key=lambda item: (-len(item), item))
        if token not in filler_terms
    ][:3]

    boost = 0.0
    if anchor_terms:
        primary_anchor = anchor_terms[0]
        if soft_match(primary_anchor, title_words):
            boost += 0.42
        elif soft_match(primary_anchor, content_words):
            boost += 0.28

        secondary_terms = anchor_terms[1:]
        if secondary_terms:
            secondary_title_overlap = (
                sum(1 for term in secondary_terms if soft_match(term, title_words)) / len(secondary_terms)
            )
            secondary_content_overlap = (
                sum(1 for term in secondary_terms if soft_match(term, content_words)) / len(secondary_terms)
            )
            boost += (secondary_title_overlap * 0.18) + (secondary_content_overlap * 0.10)

        if not soft_match(primary_anchor, result_words) and len(q_words) > 3 and overlap > 0.0 and latent_similarity < 0.28:
            boost -= 0.10

    return clamp(overlap + boost + (latent_similarity * 0.18), 0.0, 1.0)


def marginal_gain(result, selected_results, q_words):
    relevance = source_relevance(result, q_words)
    informative = clamp(result.get("informativeScore", 0.5))
    authority = clamp(result.get("authorityScore", 0.5))
    
    current_concepts = result.get("_concept_keys")
    if current_concepts is None:
        current_concepts = extract_concept_keys(result)
        
    seen_concepts = set()
    content_overlap = 0.0

    current_signature = result.get("_signature")
    if current_signature is None:
        current_signature = content_signature_tokens(result.get("content", ""))

    for selected in selected_results:
        selected_concepts = selected.get("_concept_keys")
        if selected_concepts is None:
            selected_concepts = extract_concept_keys(selected)
        seen_concepts.update(selected_concepts)
        
        selected_signature = selected.get("_signature")
        if selected_signature is None:
            selected_signature = content_signature_tokens(selected.get("content", ""))
            
        content_overlap = max(
            content_overlap,
            jaccard_similarity(current_signature, selected_signature),
        )

    concept_overlap = (
        len(current_concepts.intersection(seen_concepts)) / max(len(current_concepts), 1)
        if current_concepts else 0.25
    )

    return (
        (relevance * 0.34)
        + (informative * 0.28)
        + (authority * 0.20)
        + ((1.0 - concept_overlap) * 0.18)
        - (content_overlap * 0.16)
    )

def normalize_http_url(url):
    return normalize_http_url_impl(url)


def fetch_page_document(url, headers, max_chars=1800):
    return fetch_page_document_impl(
        url,
        headers,
        normalize_space=normalize_space,
        extract_sentences=extract_sentences,
        page_fetch_timeout=PAGE_FETCH_TIMEOUT,
        max_chars=max_chars,
    )


def fetch_page_excerpt(url, headers, max_chars=1800):
    return fetch_page_excerpt_impl(
        url,
        headers,
        normalize_space=normalize_space,
        extract_sentences=extract_sentences,
        page_fetch_timeout=PAGE_FETCH_TIMEOUT,
        max_chars=max_chars,
    )


def search_wikipedia(query, headers, limit=5):
    return search_wikipedia_impl(
        query,
        headers,
        limit,
        get_fallback_query=get_fallback_query,
        normalize_space=normalize_space,
        search_request_timeout=SEARCH_REQUEST_TIMEOUT,
        debug=lambda message: print(f"DEBUG: {message}", file=sys.stderr),
    )


def search_duckduckgo(query, headers, limit=5):
    return search_duckduckgo_impl(
        query,
        headers,
        limit,
        normalize_space=normalize_space,
        search_request_timeout=SEARCH_REQUEST_TIMEOUT,
        debug=lambda message: print(f"DEBUG: {message}", file=sys.stderr),
    )


def search_bing(query, headers, limit=5):
    return search_bing_impl(
        query,
        headers,
        limit,
        normalize_space=normalize_space,
        search_request_timeout=SEARCH_REQUEST_TIMEOUT,
        debug=lambda message: print(f"DEBUG: {message}", file=sys.stderr),
    )


def search_google(query, headers, limit=5):
    return search_google_impl(
        query,
        headers,
        limit,
        normalize_space=normalize_space,
        search_request_timeout=SEARCH_REQUEST_TIMEOUT,
        debug=lambda message: print(f"DEBUG: {message}", file=sys.stderr),
    )


def fetch_manual_sources(manual_urls, headers):
    return fetch_manual_sources_impl(
        manual_urls,
        headers,
        normalize_space=normalize_space,
        extract_sentences=extract_sentences,
        page_fetch_timeout=PAGE_FETCH_TIMEOUT,
    )


def interleave_result_lists(*result_groups):
    return interleave_result_lists_impl(*result_groups)


def get_fallback_query(query):
    return get_fallback_query_impl(
        query,
        tokenize=tokenize,
        stop_words=STOP_WORDS,
        normalize_space=normalize_space,
    )


def results_miss_query_focus(results, q_words):
    return results_miss_query_focus_impl(
        results,
        q_words,
        tokenize=tokenize,
        expand_query_focus_words=expand_query_focus_words,
    )


def search_web(query, source_config=None):
    def perform_search(current_query, source_selection):
        headers = build_search_headers(
            choose_user_agent=lambda: random.choice(USER_AGENTS),
        )
        time.sleep(random.uniform(0.5, 1.5))
        return run_provider_searches(
            current_query,
            source_selection,
            headers=headers,
            search_wikipedia_fn=search_wikipedia,
            search_duckduckgo_fn=search_duckduckgo,
            search_google_fn=search_google,
            search_bing_fn=search_bing,
            debug=lambda message: print(f"DEBUG: {message}", file=sys.stderr),
        )

    return search_web_results(
        query,
        source_config,
        normalize_source_config=normalize_source_config,
        query_words=query_words,
        expand_query_focus_words=expand_query_focus_words,
        tokenize=tokenize,
        normalize_space=normalize_space,
        source_relevance=source_relevance,
        perform_search=perform_search,
        fetch_manual_sources=fetch_manual_sources,
        dedupe_results=dedupe_results,
        get_fallback_query=get_fallback_query,
        results_miss_query_focus=results_miss_query_focus,
        build_adaptive_fallback_results=lambda current_query, results, desired_count: build_adaptive_fallback_results_impl(
            current_query,
            results,
            desired_count=desired_count,
            tokenize=tokenize,
            stop_words=STOP_WORDS,
            normalize_space=normalize_space,
            normalize_term_key=normalize_term_key,
            unique_preserve_order=unique_preserve_order,
            build_definition_candidates=build_definition_candidates,
            build_subtopic_candidates=build_subtopic_candidates,
        ),
        choose_user_agent=lambda: random.choice(USER_AGENTS),
        debug=lambda message: print(f"DEBUG: {message}", file=sys.stderr),
    )

def get_mock_results(query):
    return build_adaptive_fallback_results_impl(
        query,
        (),
        desired_count=10,
        tokenize=tokenize,
        stop_words=STOP_WORDS,
        normalize_space=normalize_space,
        normalize_term_key=normalize_term_key,
        unique_preserve_order=unique_preserve_order,
        build_definition_candidates=build_definition_candidates,
        build_subtopic_candidates=build_subtopic_candidates,
    )

def calculate_fitness(individual, all_results, query):
    q_words = query_words(query)
    focus_words = expand_query_focus_words(q_words)
    if any("_semantic_coherence" not in result for result in all_results):
        attach_selection_features(
            all_results,
            q_words,
            focus_words,
            tokenize=tokenize,
            normalize_space=normalize_space,
            source_relevance=source_relevance,
            extract_concept_keys=extract_concept_keys,
            content_signature_tokens=content_signature_tokens,
            clamp=clamp,
        )
    score, _ = calculate_selection_fitness(
        individual,
        all_results,
        query,
        unique_preserve_order=unique_preserve_order,
        query_words=query_words,
        expand_query_focus_words=expand_query_focus_words,
        source_relevance=source_relevance,
        tokenize=tokenize,
        extract_key_concepts=extract_key_concepts,
        extract_concept_keys=extract_concept_keys,
        content_signature_tokens=content_signature_tokens,
        jaccard_similarity=jaccard_similarity,
        average=average,
    )
    return score


def calculate_fitness_breakdown(individual, all_results, query):
    q_words = query_words(query)
    focus_words = expand_query_focus_words(q_words)
    if any("_semantic_coherence" not in result for result in all_results):
        attach_selection_features(
            all_results,
            q_words,
            focus_words,
            tokenize=tokenize,
            normalize_space=normalize_space,
            source_relevance=source_relevance,
            extract_concept_keys=extract_concept_keys,
            content_signature_tokens=content_signature_tokens,
            clamp=clamp,
        )
    _, breakdown = calculate_selection_fitness(
        individual,
        all_results,
        query,
        unique_preserve_order=unique_preserve_order,
        query_words=query_words,
        expand_query_focus_words=expand_query_focus_words,
        source_relevance=source_relevance,
        tokenize=tokenize,
        extract_key_concepts=extract_key_concepts,
        extract_concept_keys=extract_concept_keys,
        content_signature_tokens=content_signature_tokens,
        jaccard_similarity=jaccard_similarity,
        average=average,
    )
    return breakdown


def greedy_seed_indices(all_results, q_words, target_size):
    return ga_greedy_seed_indices(
        all_results,
        q_words,
        target_size,
        marginal_gain=marginal_gain,
    )


def ensure_target_size(indices, target_size, pool_size, rng):
    return ga_ensure_target_size(indices, target_size, pool_size, rng)


def crossover(parent_a, parent_b, target_size, pool_size, rng):
    return ga_crossover(parent_a, parent_b, target_size, pool_size, rng)


def mutate(individual, ranked_indices, target_size, pool_size, rng):
    return ga_mutate(individual, ranked_indices, target_size, pool_size, rng)


def tournament_pick(scored_population, rng, size=4):
    return ga_tournament_pick(scored_population, rng, size=size)

def evolve(all_results, query, generations=10, pop_size=30):
    normalized_results = dedupe_results(all_results, query)
    if not normalized_results:
        return []

    if len(normalized_results) < 10:
        generations = min(generations, 5)
        pop_size = min(pop_size, 15)
    elif len(normalized_results) > 50:
        generations = min(generations, 8)
        pop_size = min(pop_size, 25)

    q_words = query_words(query)
    focus_words = expand_query_focus_words(q_words)
    fitness_cache = {}

    def get_fitness(individual):
        key = tuple(sorted(individual))
        if key not in fitness_cache:
            fitness_cache[key] = calculate_fitness(individual, normalized_results, query)
        return fitness_cache[key]

    attach_selection_features(
        normalized_results,
        q_words,
        focus_words,
        tokenize=tokenize,
        normalize_space=normalize_space,
        source_relevance=source_relevance,
        extract_concept_keys=extract_concept_keys,
        content_signature_tokens=content_signature_tokens,
        clamp=clamp,
    )

    if len(normalized_results) == 1:
        only_result = dict(normalized_results[0])
        only_result['fitness'] = round(get_fitness([0]), 6)
        for key in list(only_result.keys()):
            if key.startswith("_"):
                del only_result[key]
        return [only_result]
    ordered_results, _history = evolve_population(
        normalized_results,
        query,
        q_words,
        generations=generations,
        pop_size=pop_size,
        calculate_fitness=get_fitness,
        marginal_gain=marginal_gain,
        clamp=clamp,
    )
    return ordered_results

def extract_sentences(text):
    normalized = normalize_space(text)
    if not normalized:
        return []

    sentences = re.split(r'(?<=[.!?])\s+', normalized)
    return [sentence.strip() for sentence in sentences if len(sentence.strip()) > 20]
    
def choose_theme_candidates(selected_sources, query):
    clusters = build_source_clusters(
        selected_sources,
        query,
        tokenize=tokenize,
        query_words=query_words,
        expand_query_focus_words=expand_query_focus_words,
        normalize_term_key=normalize_term_key,
        stop_words=STOP_WORDS,
        source_relevance=source_relevance,
    )
    return choose_theme_candidates_impl(
        clusters,
        selected_sources,
        query,
        normalize_term_key=normalize_term_key,
    )


def choose_items_for_chapter(items, keyword_set, used_keys, key_name, text_getter, limit):
    return choose_items_for_chapter_impl(
        items,
        keyword_set,
        used_keys,
        key_name,
        text_getter,
        limit,
        tokenize=tokenize,
        normalize_space=normalize_space,
    )


def build_fallback_paragraph(query, title, supporting_sources):
    return build_fallback_paragraph_impl(query, title, supporting_sources)


def score_sentence(sentence, q_words, theme_words, source_quality, novelty_penalty, words=None):
    return score_sentence_impl(
        sentence,
        q_words,
        theme_words,
        source_quality,
        novelty_penalty,
        words=words,
    )

def generate_webbook(selected_sources, query):
    normalized_sources = dedupe_results(selected_sources, query)
    if not normalized_sources:
        return {
            "topic": query,
            "chapters": [],
            "id": f"book-{int(time.time())}",
            "timestamp": int(time.time() * 1000)
        }

    q_words = query_words(query)
    focus_words = expand_query_focus_words(q_words)
    chapter_templates = get_chapter_templates(
        CHAPTER_TEMPLATES,
        query,
        normalized_sources,
        tokenize=tokenize,
        stop_words=STOP_WORDS,
        normalize_space=normalize_space,
    )
    clusters = build_source_clusters(
        normalized_sources,
        query,
        tokenize=tokenize,
        query_words=query_words,
        expand_query_focus_words=expand_query_focus_words,
        normalize_term_key=normalize_term_key,
        stop_words=STOP_WORDS,
        source_relevance=source_relevance,
    )
    theme_candidates = choose_theme_candidates_impl(
        clusters,
        normalized_sources,
        query,
        normalize_term_key=normalize_term_key,
    )
    semantic_corpus = [
        normalize_space(
            " ".join(
                part for part in (
                    source.get("title", ""),
                    source.get("content", ""),
                    " ".join(
                        f"{item.get('term', '')} {item.get('description', '')}"
                        for item in (source.get("definitions", []) or [])
                        if isinstance(item, dict)
                    ),
                    " ".join(
                        f"{item.get('title', '')} {item.get('summary', '')}"
                        for item in (source.get("subTopics", []) or [])
                        if isinstance(item, dict)
                    ),
                ) if part
            )
        )
        for source in normalized_sources[:12]
    ]
    semantic_subtopic_tree = extract_subtopic_tree(
        query,
        semantic_corpus,
        max_topics=max(6, min(len(chapter_templates), 10)),
    )
    semantic_title_path = build_semantic_title_path(
        query,
        semantic_subtopic_tree,
        theme_candidates,
        len(chapter_templates),
    )
    global_definitions = dedupe_definitions([
        definition
        for source in normalized_sources
        for definition in (source.get("definitions", []) or [])
    ])
    global_subtopics = dedupe_subtopics([
        subtopic
        for source in normalized_sources
        for subtopic in (source.get("subTopics", []) or [])
    ])
    cluster_usage = {cluster["id"]: 0 for cluster in clusters}

    if not clusters:
        clusters = [{
            "id": 0,
            "label": normalized_sources[0].get("title", query),
            "focus_phrase": normalized_sources[0].get("title", query),
            "keywords": set(tokenize(normalized_sources[0].get("title", "") + " " + normalized_sources[0].get("content", ""))),
            "focus_words": set(focus_words),
            "phrase_keys": {normalize_term_key(normalized_sources[0].get("title", query))},
            "sources": normalized_sources,
            "source_indices": list(range(len(normalized_sources))),
            "definitions": global_definitions,
            "subtopics": global_subtopics,
            "average_relevance": average([source_relevance(source, q_words) for source in normalized_sources], 0.5),
        }]
        cluster_usage = {0: 0}

    chapters = []
    used_sentence_keys = set()
    used_definition_terms = set()
    used_subtopic_titles = set()

    for chapter_index, (base_label, template_keywords) in enumerate(chapter_templates):
        selected_cluster = select_cluster_for_template(
            clusters,
            template_keywords,
            focus_words,
            cluster_usage,
        )
        if selected_cluster:
            cluster_usage[selected_cluster["id"]] = cluster_usage.get(selected_cluster["id"], 0) + 1

        focus_phrase = (
            selected_cluster.get("focus_phrase")
            or (theme_candidates[chapter_index % len(theme_candidates)] if theme_candidates else "")
        )
        semantic_title_focus = (
            semantic_title_path[chapter_index]
            if chapter_index < len(semantic_title_path)
            else ""
        )
        chapter_title = build_chapter_title(
            base_label,
            query,
            focus_phrase,
            [],
            [],
            [],
            focus_words,
            template_keywords,
            semantic_subtopic_tree=semantic_subtopic_tree,
            semantic_title_focus=semantic_title_focus,
            chapter_index=chapter_index,
            chapter_count=len(chapter_templates),
            tokenize=tokenize,
            stop_words=STOP_WORDS,
            normalize_term_key=normalize_term_key,
        )

        keyword_set = set(tokenize(chapter_title)).union(template_keywords).union(focus_words)
        sentence_pool = build_chapter_sentence_pool(
            selected_cluster,
            normalized_sources,
            q_words,
            extract_sentences=extract_sentences,
            tokenize=tokenize,
            source_relevance=source_relevance,
        )
        if not sentence_pool:
            fallback_source = normalized_sources[0]
            fallback_sentence = fallback_source.get("content", f"Limited content was available for {query}.")
            sentence_pool = [{
                "sentence": fallback_sentence,
                "words": set(tokenize(fallback_sentence)),
                "source_index": 0,
                "sentence_index": 0,
                "source": fallback_source,
                "source_quality": 0.7,
                "cluster_priority": 0,
                "pool_position": 0,
            }]

        scored_sentences = []
        for entry in sentence_pool:
            sentence_key = (entry["source_index"], entry["sentence_index"])
            novelty_penalty = 0.45 if sentence_key in used_sentence_keys else 0.0
            score = score_sentence(
                entry["sentence"],
                focus_words,
                keyword_set,
                entry["source_quality"],
                novelty_penalty,
                words=entry.get("words")
            )
            score -= entry.get("cluster_priority", 0) * 0.12
            scored_sentences.append((score, entry))

        scored_sentences.sort(
            key=lambda item: (
                item[0],
                -item[1].get("cluster_priority", 0),
                -item[1].get("source_quality", 0.0),
            ),
            reverse=True,
        )

        selected_entries = []
        supporting_source_indexes = []
        for _, entry in scored_sentences:
            sentence_key = (entry["source_index"], entry["sentence_index"])
            if sentence_key in used_sentence_keys:
                continue
            selected_entries.append(entry)
            supporting_source_indexes.append(entry["source_index"])
            used_sentence_keys.add(sentence_key)
            if len(selected_entries) >= 6:
                break

        if len(selected_entries) < 4:
            for _, entry in scored_sentences:
                sentence_key = (entry["source_index"], entry["sentence_index"])
                if sentence_key in [(item["source_index"], item["sentence_index"]) for item in selected_entries]:
                    continue
                selected_entries.append(entry)
                supporting_source_indexes.append(entry["source_index"])
                if len(selected_entries) >= 6:
                    break

        selected_entries.sort(key=lambda entry: (entry.get("cluster_priority", 0), entry["source_index"], entry["sentence_index"]))
        paragraph = " ".join(entry["sentence"] for entry in selected_entries).strip()
        supporting_sources = [
            normalized_sources[index]
            for index in unique_preserve_order(supporting_source_indexes)
            if 0 <= index < len(normalized_sources)
        ]

        if len(tokenize(paragraph)) < 55:
            paragraph = build_fallback_paragraph(query, chapter_title, supporting_sources)

        chapter_definition_pool = dedupe_definitions([
            definition
            for definition in (selected_cluster.get("definitions", []) or [])
        ] + [
            definition
            for source in supporting_sources
            for definition in (source.get("definitions", []) or [])
        ] + global_definitions)
        chapter_subtopic_pool = dedupe_subtopics([
            subtopic
            for subtopic in (selected_cluster.get("subtopics", []) or [])
        ] + [
            subtopic
            for source in supporting_sources
            for subtopic in (source.get("subTopics", []) or [])
        ] + global_subtopics)

        chapter_title = build_chapter_title(
            base_label,
            query,
            focus_phrase,
            supporting_sources,
            chapter_definition_pool,
            chapter_subtopic_pool,
            focus_words,
            template_keywords,
            semantic_subtopic_tree=semantic_subtopic_tree,
            semantic_title_focus=semantic_title_focus,
            chapter_index=chapter_index,
            chapter_count=len(chapter_templates),
            tokenize=tokenize,
            stop_words=STOP_WORDS,
            normalize_term_key=normalize_term_key,
        )
        keyword_set = set(tokenize(chapter_title)).union(template_keywords).union(focus_words)

        chapter_definitions = choose_items_for_chapter(
            chapter_definition_pool,
            keyword_set,
            used_definition_terms,
            "term",
            lambda definition: f"{definition.get('term', '')} {definition.get('description', '')}",
            4,
        )
        chapter_subtopics = choose_items_for_chapter(
            chapter_subtopic_pool,
            keyword_set,
            used_subtopic_titles,
            "title",
            lambda subtopic: f"{subtopic.get('title', '')} {subtopic.get('summary', '')}",
            3,
        )

        if not chapter_definitions and supporting_sources:
            chapter_definitions = build_definition_candidates(
                supporting_sources[0].get("title", chapter_title),
                paragraph,
                supporting_sources[0].get("url", ""),
            )[:2]
        if not chapter_subtopics and supporting_sources:
            chapter_subtopics = build_subtopic_candidates(
                supporting_sources[0].get("title", chapter_title),
                paragraph,
                query,
                supporting_sources[0].get("url", ""),
            )[:2]

        source_urls = [
            {"title": source.get("title", source.get("url", "Source")), "url": source.get("url", "")}
            for source in supporting_sources[:3]
        ]
        if not source_urls:
            source_urls = [{"title": normalized_sources[0].get("title", "Source"), "url": normalized_sources[0].get("url", "")}]

        visual_seed_candidates = [word for word in tokenize(focus_phrase or chapter_title) if word not in STOP_WORDS]
        visual_seed = visual_seed_candidates[0] if visual_seed_candidates else (tokenize(query)[0] if tokenize(query) else "evolution")

        chapters.append({
            "title": f"Chapter {chapter_index + 1}: {chapter_title}",
            "content": paragraph,
            "definitions": chapter_definitions,
            "subTopics": chapter_subtopics,
            "sourceUrls": source_urls,
            "visualSeed": visual_seed
        })
        
    return {
        "topic": query,
        "chapters": chapters,
        "id": f"book-{int(time.time())}",
        "timestamp": int(time.time() * 1000)
    }

def strip_internal_keys(data):
    """Recursively remove keys starting with '_' to prevent JSON serialization errors."""
    if isinstance(data, list):
        for item in data:
            strip_internal_keys(item)
    elif isinstance(data, dict):
        for key in list(data.keys()):
            if key.startswith("_"):
                del data[key]
            else:
                strip_internal_keys(data[key])
    return data

def main():
    # Redirect all accidental stdout to stderr to ensure only our JSON reaches the caller via stdout
    with contextlib.redirect_stdout(sys.stderr):
        try:
            if len(sys.argv) < 3:
                sys.stderr.write("Error: Query and mode are required\n")
                print_json({"error": "Query and mode are required"})
                return

            mode = sys.argv[1]
            query = sys.argv[2]

            def read_payload():
                if len(sys.argv) >= 4:
                    return sys.argv[3]

                stdin_payload = sys.stdin.read()
                if stdin_payload and stdin_payload.strip():
                    return stdin_payload

                raise ValueError("Population payload is required")

            def read_optional_payload(default=None):
                if len(sys.argv) >= 4:
                    return sys.argv[3]

                stdin_payload = sys.stdin.read()
                if stdin_payload and stdin_payload.strip():
                    return stdin_payload

                return default
            
            if mode == "search":
                try:
                    raw_search_config = read_optional_payload("{}")
                    source_config = json.loads(raw_search_config) if raw_search_config else {}
                except Exception:
                    source_config = {}

                all_results = search_web(query, source_config)
                print_json(strip_internal_keys(all_results))
            elif mode == "evolve":
                try:
                    payload = read_payload()
                    all_results = json.loads(payload)
                    evolved_sources = evolve(all_results, query)
                    print_json(strip_internal_keys(evolved_sources))
                except json.JSONDecodeError as e:
                    print_json({"error": f"Invalid JSON payload for evolution: {str(e)}"})
                except Exception as e:
                    print_json({"error": f"Evolution failed: {str(e)}"})
            elif mode == "assemble":
                try:
                    payload = read_payload()
                    evolved_sources = json.loads(payload)
                    webbook = generate_webbook(evolved_sources, query)
                    print_json(strip_internal_keys(webbook))
                except json.JSONDecodeError as e:
                    print_json({"error": f"Invalid JSON payload for assembly: {str(e)}"})
                except Exception as e:
                    print_json({"error": f"Assembly failed: {str(e)}"})
            else:
                print_json({"error": f"Invalid mode: {mode}"})
        except Exception as e:
            print_json({"error": f"Unexpected engine error: {str(e)}"})

def print_json(data):
    """Helper to print JSON to the actual stdout even when redirected."""
    try:
        sys.__stdout__.write(json.dumps(data) + "\n")
        sys.__stdout__.flush()
    except Exception as e:
        # If JSON serialization fails, try to return a safe error message
        try:
            error_msg = {"error": "JSON serialization failed", "details": str(e)}
            sys.__stdout__.write(json.dumps(error_msg) + "\n")
            sys.__stdout__.flush()
        except:
            # Last resort: raw write
            sys.__stdout__.write('{"error": "Fatal JSON serialization error"}\n')
            sys.__stdout__.flush()

if __name__ == "__main__":
    main()
