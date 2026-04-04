"""Search orchestration helpers for the evolutionary engine."""

from functools import lru_cache
import html
import json
import re
import urllib.parse
import urllib.request
from html.parser import HTMLParser
from typing import Any, Callable, Dict, List, Optional, Sequence

from .features import build_quality_feature_snapshot
from .nlp import semantic_cooccurrence_filter


class MLStripper(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.reset()
        self.strict = False
        self.convert_charrefs = True
        self.text: List[str] = []

    def handle_data(self, data: str) -> None:
        self.text.append(data)

    def get_data(self) -> str:
        return "".join(self.text)


def strip_tags(raw_html: str) -> str:
    stripper = MLStripper()
    stripper.feed(raw_html)
    return stripper.get_data()


def normalize_http_url(url: str) -> str:
    normalized_url = re.sub(r"\s+", " ", str(url or "")).strip().strip(".,;)")
    if not normalized_url:
        return ""

    if not re.match(r"^[a-zA-Z][a-zA-Z0-9+.-]*://", normalized_url):
        normalized_url = "https://" + normalized_url

    parsed = urllib.parse.urlparse(normalized_url)
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        return ""

    return urllib.parse.urlunparse((
        parsed.scheme,
        parsed.netloc,
        parsed.path or "",
        parsed.params or "",
        parsed.query or "",
        parsed.fragment or "",
    ))


def decode_result_url(url: str) -> str:
    normalized_url = normalize_http_url(html.unescape(url))
    if not normalized_url:
        return ""

    parsed = urllib.parse.urlparse(normalized_url)
    if "duckduckgo.com" in parsed.netloc.lower():
        params = urllib.parse.parse_qs(parsed.query)
        target = params.get("uddg")
        if target:
            normalized_url = normalize_http_url(urllib.parse.unquote(target[0]))

    if "google." in parsed.netloc.lower() and parsed.path.startswith("/url"):
        params = urllib.parse.parse_qs(parsed.query)
        target = params.get("q")
        if target:
            normalized_url = normalize_http_url(urllib.parse.unquote(target[0]))

    return re.sub(r"\s+", " ", normalized_url).strip()


def is_search_engine_internal_url(url: str) -> bool:
    host = urllib.parse.urlparse(url).netloc.lower()
    blocked_hosts = (
        "duckduckgo.com",
        "www.google.com",
        "google.com",
        "bing.com",
        "www.bing.com",
    )
    return any(host == blocked_host or host.endswith("." + blocked_host) for blocked_host in blocked_hosts)


def can_fetch_page(url: str) -> bool:
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme not in ("http", "https"):
        return False
    if not parsed.netloc:
        return False
    if is_search_engine_internal_url(url):
        return False

    lower_path = parsed.path.lower()
    blocked_suffixes = (
        ".pdf", ".doc", ".docx", ".ppt", ".pptx", ".xls", ".xlsx",
        ".zip", ".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg",
        ".mp4", ".mp3",
    )
    if lower_path.endswith(blocked_suffixes):
        return False

    return True


def title_from_url(url: str) -> str:
    parsed = urllib.parse.urlparse(url)
    host = parsed.netloc.lower().replace("www.", "")
    path_parts = [part for part in parsed.path.split("/") if part]
    if path_parts:
        slug = path_parts[-1].replace("-", " ").replace("_", " ")
        slug = re.sub(r"\.[A-Za-z0-9]+$", "", slug)
        slug = re.sub(r"\s+", " ", slug).strip()
        if slug:
            return slug.title()
    return host.title() or url


def extract_html_title(
    document: str,
    *,
    normalize_space: Callable[[Any], str],
) -> str:
    match = re.search(r"(?is)<title[^>]*>(.*?)</title>", document)
    if not match:
        return ""
    return normalize_space(strip_tags(html.unescape(match.group(1))))


def extract_readable_text_from_html(
    document: str,
    *,
    normalize_space: Callable[[Any], str],
) -> str:
    cleaned = re.sub(r"(?is)<(script|style|noscript|svg).*?>.*?</\1>", " ", document)
    cleaned = re.sub(r"(?is)<!--.*?-->", " ", cleaned)
    return normalize_space(html.unescape(strip_tags(cleaned)))


def summarize_text(
    text: str,
    *,
    normalize_space: Callable[[Any], str],
    extract_sentences: Callable[[str], Sequence[str]],
    max_chars: int = 1800,
    max_sentences: int = 6,
) -> str:
    sentences = list(extract_sentences(text))
    if not sentences:
        return normalize_space(text)[:max_chars]

    summary: List[str] = []
    total = 0
    for sentence in sentences:
        projected = total + len(sentence) + (1 if summary else 0)
        if summary and (projected > max_chars or len(summary) >= max_sentences):
            break
        summary.append(sentence)
        total = projected

    return " ".join(summary) if summary else normalize_space(text)[:max_chars]


def fetch_page_document(
    url: str,
    headers: Dict[str, str],
    *,
    normalize_space: Callable[[Any], str],
    extract_sentences: Callable[[str], Sequence[str]],
    page_fetch_timeout: int,
    max_chars: int = 1800,
) -> Dict[str, Any]:
    if not can_fetch_page(url):
        return {"title": title_from_url(url), "content": ""}

    try:
        request = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(request, timeout=page_fetch_timeout) as response:
            content_type = response.headers.get("Content-Type", "")
            raw_body = response.read(150000)
    except Exception:
        return {"title": title_from_url(url), "content": ""}

    charset_match = re.search(r"charset=([A-Za-z0-9._-]+)", content_type, re.IGNORECASE)
    declared_encoding = charset_match.group(1) if charset_match else "utf-8"

    # Try the declared encoding first (strict), fall back to UTF-8 (strict),
    # then latin-1 (never raises), to avoid silently discarding bytes.
    decoded = None
    for enc in (declared_encoding, "utf-8", "latin-1"):
        try:
            decoded = raw_body.decode(enc, errors="strict")
            break
        except (UnicodeDecodeError, LookupError):
            continue
    if decoded is None:
        decoded = raw_body.decode("utf-8", errors="replace")
    # Scrub any Unicode replacement characters left by errors="replace".
    decoded = decoded.replace("\ufffd", " ")

    if "html" in content_type.lower() or "<html" in decoded.lower():
        page_title = extract_html_title(decoded, normalize_space=normalize_space)
        text = extract_readable_text_from_html(decoded, normalize_space=normalize_space)
    else:
        page_title = title_from_url(url)
        text = normalize_space(decoded)

    if len(text) < 160:
        return {"title": page_title or title_from_url(url), "content": ""}

    return {
        "title": page_title or title_from_url(url),
        "content": summarize_text(
            text,
            normalize_space=normalize_space,
            extract_sentences=extract_sentences,
            max_chars=max_chars,
        ),
    }


def fetch_page_excerpt(
    url: str,
    headers: Dict[str, str],
    *,
    normalize_space: Callable[[Any], str],
    extract_sentences: Callable[[str], Sequence[str]],
    page_fetch_timeout: int,
    max_chars: int = 1800,
) -> str:
    return fetch_page_document(
        url,
        headers,
        normalize_space=normalize_space,
        extract_sentences=extract_sentences,
        page_fetch_timeout=page_fetch_timeout,
        max_chars=max_chars,
    ).get("content", "")


import unicodedata as _unicodedata

_SEARCH_CHAR_MAP = str.maketrans({
    '\xa0': ' ', '\u00ad': '', '\u200b': '', '\u200c': '', '\u200d': '',
    '\ufeff': '', '\u2018': "'", '\u2019': "'", '\u201a': "'", '\u201b': "'",
    '\u201c': '"', '\u201d': '"', '\u201e': '"', '\u2013': '-', '\u2014': '-',
    '\u2015': '-', '\u2026': '...', '\u2022': '-', '\u00b7': '-',
    '\u2039': '<', '\u203a': '>', '\u00ab': '"', '\u00bb': '"',
})


def _cached_normalize_space(text: Any) -> str:
    text = str(text or "")
    text = _unicodedata.normalize("NFKC", text)
    text = text.translate(_SEARCH_CHAR_MAP)
    return re.sub(r"\s+", " ", text).strip()


def _normalize_comparable_text(text: str) -> str:
    normalized = _cached_normalize_space(html.unescape(str(text or ""))).lower().replace("&", " and ")
    return re.sub(r"[^a-z0-9\s]", " ", normalized)


def _calculate_text_similarity(left: str, right: str) -> float:
    left_tokens = {token for token in _normalize_comparable_text(left).split() if len(token) >= 3}
    right_tokens = {token for token in _normalize_comparable_text(right).split() if len(token) >= 3}
    if not left_tokens or not right_tokens:
        return 0.0
    return len(left_tokens.intersection(right_tokens)) / max(len(left_tokens.union(right_tokens)), 1)


def _split_search_sentences(text: str) -> List[str]:
    normalized = _cached_normalize_space(text)
    if not normalized:
        return []
    sentences = [segment.strip() for segment in re.split(r"(?<=[.!?])\s+", normalized) if segment.strip()]
    return sentences or [normalized]


def sanitize_search_snippet(text: str) -> str:
    cleaned = _cached_normalize_space(re.sub(r"\.\.\.\s*(?=[A-Z])", " ", text or ""))
    unique: List[str] = []
    for sentence in _split_search_sentences(cleaned):
        if len(sentence) < 35:
            continue
        if any(_calculate_text_similarity(existing, sentence) >= 0.88 for existing in unique):
            continue
        unique.append(sentence)
        if len(unique) >= 4:
            break
    return " ".join(unique) if unique else cleaned


def _merge_evidence_text(snippet: str, page_content: str, *, max_chars: int = 2200) -> str:
    merged: List[str] = []
    for block in (sanitize_search_snippet(snippet), _cached_normalize_space(page_content)):
        for sentence in _split_search_sentences(block):
            if not sentence:
                continue
            if any(_calculate_text_similarity(existing, sentence) >= 0.9 for existing in merged):
                continue
            candidate = " ".join(merged + [sentence])
            if merged and len(candidate) > max_chars:
                return " ".join(merged)[:max_chars]
            merged.append(sentence)
    return (" ".join(merged) if merged else _cached_normalize_space(page_content or snippet))[:max_chars]


@lru_cache(maxsize=96)
def _cached_wikipedia_lookup(
    query: str,
    limit: int,
    fallback_query: str,
    search_request_timeout: int,
) -> tuple[dict[str, Any], ...]:
    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
        ),
        "Accept-Language": "en-US,en;q=0.9",
    }
    encoded_query = urllib.parse.quote(query)
    search_url = (
        "https://en.wikipedia.org/w/api.php?action=query&list=search"
        f"&srsearch={encoded_query}&utf8=&format=json&srlimit={limit}"
    )

    try:
        request = urllib.request.Request(search_url, headers=headers)
        with urllib.request.urlopen(request, timeout=search_request_timeout) as response:
            data = json.loads(response.read().decode("utf-8"))
    except Exception:
        data = {}

    search_results = data.get("query", {}).get("search", [])

    if not search_results and fallback_query:
        encoded_fallback = urllib.parse.quote(fallback_query)
        fallback_url = (
            "https://en.wikipedia.org/w/api.php?action=query&list=search"
            f"&srsearch={encoded_fallback}&utf8=&format=json&srlimit={limit}"
        )
        try:
            fallback_request = urllib.request.Request(fallback_url, headers=headers)
            with urllib.request.urlopen(fallback_request, timeout=search_request_timeout) as fallback_response:
                fallback_data = json.loads(fallback_response.read().decode("utf-8"))
                search_results = fallback_data.get("query", {}).get("search", [])
        except Exception:
            search_results = []

    page_ids = [str(item.get("pageid")) for item in search_results if item.get("pageid")]
    page_extracts: Dict[str, str] = {}

    if page_ids:
        extract_url = (
            "https://en.wikipedia.org/w/api.php?action=query&prop=extracts&exintro=1&explaintext=1"
            f"&pageids={'|'.join(page_ids)}&format=json"
        )
        try:
            extract_request = urllib.request.Request(extract_url, headers=headers)
            with urllib.request.urlopen(extract_request, timeout=search_request_timeout) as extract_response:
                extract_data = json.loads(extract_response.read().decode("utf-8"))
                pages = extract_data.get("query", {}).get("pages", {})
                page_extracts = {
                    page_id: _cached_normalize_space(page_info.get("extract", ""))
                    for page_id, page_info in pages.items()
                }
        except Exception:
            page_extracts = {}

    results = []
    for item in search_results:
        title = _cached_normalize_space(item.get("title", ""))
        page_id = item.get("pageid")
        snippet = _cached_normalize_space(strip_tags(item.get("snippet", "")))
        content = page_extracts.get(str(page_id), snippet)

        if not content or len(content) < 50:
            content = snippet

        results.append({
            "url": f"https://en.wikipedia.org/?curid={page_id}",
            "title": title,
            "content": content,
            "searchProvider": "wikipedia",
        })

    return tuple(results)


def search_wikipedia(
    query: str,
    headers: Dict[str, str],
    limit: int = 5,
    *,
    get_fallback_query: Callable[[str], str],
    normalize_space: Callable[[Any], str],
    strip_tags_fn: Callable[[str], str] = strip_tags,
    search_request_timeout: int,
    debug: Callable[[str], None],
) -> List[Dict[str, Any]]:
    fallback_query = get_fallback_query(query) if len(query.split()) > 4 else ""
    try:
        cached_results = _cached_wikipedia_lookup(
            query,
            limit,
            fallback_query,
            search_request_timeout,
        )
    except Exception as error:
        debug(f"Wikipedia initial search failed: {error}")
        return []

    results = []
    for item in cached_results:
        result = dict(item)
        result["title"] = normalize_space(result.get("title", ""))
        result["content"] = normalize_space(result.get("content", ""))
        results.append(result)

    filtered_results = semantic_cooccurrence_filter(
        query,
        results,
        baseline_documents=results[:2],
        min_similarity=0.18,
        keep_min=1 if len(results) <= 2 else 2,
    )
    if filtered_results and len(filtered_results) < len(results):
        debug(f"Wikipedia semantic filter retained {len(filtered_results)} of {len(results)} results")

    return filtered_results[:limit] if filtered_results else results[:limit]


def _decode_html_bytes(raw: bytes, hints: str = "") -> str:
    """Decode raw HTTP bytes to str using a charset-priority fallback chain.

    1. Charset declared in *hints* (the Content-Type header value), if any.
    2. UTF-8 (strict) - most modern pages.
    3. latin-1 - never raises; covers Windows-1252 and ISO-8859-1 pages.
    4. UTF-8 with errors='replace' as a last resort; replacement chars (\ufffd)
       are stripped afterwards to avoid them surfacing in content.
    """
    declared: list[str] = []
    m = re.search(r"charset=([A-Za-z0-9._-]+)", hints, re.IGNORECASE)
    if m:
        declared = [m.group(1)]
    for enc in (*declared, "utf-8", "latin-1"):
        try:
            return raw.decode(enc, errors="strict")
        except (UnicodeDecodeError, LookupError):
            continue
    return raw.decode("utf-8", errors="replace").replace("\ufffd", " ")


def search_duckduckgo(
    query: str,
    headers: Dict[str, str],
    limit: int = 5,
    *,
    normalize_space: Callable[[Any], str],
    strip_tags_fn: Callable[[str], str] = strip_tags,
    decode_result_url_fn: Callable[[str], str] = decode_result_url,
    search_request_timeout: int,
    debug: Callable[[str], None],
) -> List[Dict[str, Any]]:
    encoded_query = urllib.parse.quote(query)
    search_url = f"https://html.duckduckgo.com/html/?q={encoded_query}&kl=us-en"
    request = urllib.request.Request(search_url, headers=headers)
    try:
        with urllib.request.urlopen(request, timeout=search_request_timeout) as response:
            raw_html = _decode_html_bytes(response.read(), response.headers.get("Content-Type", ""))
            if any(keyword in raw_html.lower() for keyword in ("captcha", "robot", "security check", "automated access")):
                debug("DuckDuckGo detected bot/captcha")
    except Exception as error:
        debug(f"DuckDuckGo fetch failed: {error}")
        return []

    result_pattern = re.compile(
        r'<div[^>]+class="[^"]*result[^"]*"[^>]*>.*?'
        r'<a[^>]+class="result__a"[^>]+href="(?P<href>[^"]+)"[^>]*>(?P<title>.*?)</a>.*?'
        r'(?:<a[^>]+class="result__snippet"[^>]*>|<div[^>]+class="result__snippet"[^>]*>)(?P<snippet>.*?)'
        r'(?:</a>|</div>)',
        re.IGNORECASE | re.DOTALL,
    )

    results = []
    seen_urls = set()
    for match in result_pattern.finditer(raw_html):
        title = normalize_space(strip_tags_fn(html.unescape(match.group("title"))))
        url = decode_result_url_fn(match.group("href"))
        snippet = normalize_space(strip_tags_fn(html.unescape(match.group("snippet"))))

        if not title or not url or url in seen_urls:
            continue

        seen_urls.add(url)
        content = normalize_space(f"{title}. {sanitize_search_snippet(snippet)}") if snippet else title
        if not content or len(content) < 30:
            continue

        results.append({
            "url": url,
            "title": title,
            "content": content,
            "searchProvider": "duckduckgo",
        })

        if len(results) >= limit:
            break

    return results


def search_bing(
    query: str,
    headers: Dict[str, str],
    limit: int = 5,
    *,
    normalize_space: Callable[[Any], str],
    strip_tags_fn: Callable[[str], str] = strip_tags,
    decode_result_url_fn: Callable[[str], str] = decode_result_url,
    is_search_engine_internal_url_fn: Callable[[str], bool] = is_search_engine_internal_url,
    search_request_timeout: int,
    debug: Callable[[str], None],
) -> List[Dict[str, Any]]:
    encoded_query = urllib.parse.quote(query)
    search_url = f"https://www.bing.com/search?q={encoded_query}&setlang=en-US&count={max(limit * 2, 10)}"
    request = urllib.request.Request(search_url, headers=headers)
    try:
        with urllib.request.urlopen(request, timeout=search_request_timeout) as response:
            raw_html = _decode_html_bytes(response.read(), response.headers.get("Content-Type", ""))
            if any(keyword in raw_html.lower() for keyword in ("captcha", "robot", "security check", "automated access")):
                debug("Bing detected bot/captcha")
    except Exception as error:
        debug(f"Bing fetch failed: {error}")
        return []

    result_pattern = re.compile(
        r'<li[^>]+class="[^"]*\bb_algo\b[^"]*"[^>]*>.*?<h2><a[^>]+href="(?P<href>[^"]+)"[^>]*>(?P<title>.*?)</a></h2>'
        r'.*?(?:<div[^>]+class="[^"]*b_caption[^"]*"[^>]*>|<p[^>]*>)(?P<snippet>.*?)(?:</div>|</p>)',
        re.IGNORECASE | re.DOTALL,
    )

    results = []
    seen_urls = set()
    for match in result_pattern.finditer(raw_html):
        title = normalize_space(strip_tags_fn(html.unescape(match.group("title"))))
        url = decode_result_url_fn(match.group("href"))
        snippet = normalize_space(strip_tags_fn(html.unescape(match.group("snippet") or "")))

        if not title or not url or url in seen_urls or is_search_engine_internal_url_fn(url):
            continue

        seen_urls.add(url)
        content = normalize_space(f"{title}. {sanitize_search_snippet(snippet)}") if snippet else title
        if not content or len(content) < 30:
            continue

        results.append({
            "url": url,
            "title": title,
            "content": content,
            "searchProvider": "bing",
        })

        if len(results) >= limit:
            break

    return results


def search_google(
    query: str,
    headers: Dict[str, str],
    limit: int = 5,
    *,
    normalize_space: Callable[[Any], str],
    strip_tags_fn: Callable[[str], str] = strip_tags,
    decode_result_url_fn: Callable[[str], str] = decode_result_url,
    is_search_engine_internal_url_fn: Callable[[str], bool] = is_search_engine_internal_url,
    search_request_timeout: int,
    debug: Callable[[str], None],
) -> List[Dict[str, Any]]:
    encoded_query = urllib.parse.quote(query)
    search_url = f"https://www.google.com/search?gbv=1&hl=en&num={max(limit * 2, 15)}&q={encoded_query}"
    request = urllib.request.Request(search_url, headers=headers)
    try:
        with urllib.request.urlopen(request, timeout=search_request_timeout) as response:
            raw_html = _decode_html_bytes(response.read(), response.headers.get("Content-Type", ""))
            if any(keyword in raw_html.lower() for keyword in ("captcha", "robot", "security check", "automated access")):
                debug("Google detected bot/captcha")
    except Exception as error:
        debug(f"Google fetch failed: {error}")
        return []

    result_pattern = re.compile(
        r'<div[^>]+class="[^"]*\bg\b[^"]*"[^>]*>.*?'
        r'<a[^>]+href="(?P<href>/url\?q=[^"&]+)[^"]*"[^>]*>.*?'
        r'<h3[^>]*>(?P<title>.*?)</h3>.*?'
        r'(?:<div[^>]+class="[^"]*(?:s|VwiC3b|yDqY9b|st)[^"]*"[^>]*>|<span[^>]+class="[^"]*st[^"]*"[^>]*>)(?P<snippet>.*?)'
        r'(?:</div>|</span>)',
        re.IGNORECASE | re.DOTALL,
    )
    minimal_pattern = re.compile(
        r'<a href="(?P<href>/url\?q=[^"&]+)[^"]*".*?><h3[^>]*>(?P<title>.*?)</h3>',
        re.IGNORECASE | re.DOTALL,
    )
    fallback_pattern = re.compile(
        r'<a[^>]+href="(?P<href>/url\?q=[^"&]+)[^"]*"[^>]*>.*?'
        r'<h3[^>]*>(?P<title>.*?)</h3>.*?'
        r'(?P<snippet><span[^>]*>.*?</span>)',
        re.IGNORECASE | re.DOTALL,
    )

    results = []
    seen_urls = set()
    matches = list(result_pattern.finditer(raw_html))
    if not matches:
        matches = list(minimal_pattern.finditer(raw_html))
    if not matches:
        matches = list(fallback_pattern.finditer(raw_html))

    for match in matches:
        title = normalize_space(strip_tags_fn(html.unescape(match.group("title"))))
        url = decode_result_url_fn(match.group("href"))

        snippet = ""
        try:
            snippet = match.group("snippet")
        except IndexError:
            pass

        snippet = normalize_space(strip_tags_fn(html.unescape(snippet or "")))
        if not title or not url or url in seen_urls or is_search_engine_internal_url_fn(url):
            continue

        seen_urls.add(url)
        content = normalize_space(f"{title}. {sanitize_search_snippet(snippet)}") if snippet else title
        if not content or len(content) < 30:
            continue

        results.append({
            "url": url,
            "title": title,
            "content": content,
            "searchProvider": "google",
        })

        if len(results) >= limit:
            break

    return results


def fetch_manual_sources(
    manual_urls: Sequence[str],
    headers: Dict[str, str],
    *,
    normalize_space: Callable[[Any], str],
    extract_sentences: Callable[[str], Sequence[str]],
    page_fetch_timeout: int,
) -> List[Dict[str, Any]]:
    results = []

    for url in manual_urls:
        normalized_url = normalize_http_url(url)
        if not normalized_url:
            continue

        page_document = fetch_page_document(
            normalized_url,
            headers,
            normalize_space=normalize_space,
            extract_sentences=extract_sentences,
            page_fetch_timeout=page_fetch_timeout,
        )
        content = page_document.get("content", "")
        if not content:
            continue

        results.append({
            "url": normalized_url,
            "title": page_document.get("title") or title_from_url(normalized_url),
            "content": content,
            "searchProvider": "manual",
        })

    return results


def run_provider_searches(
    query: str,
    source_selection: Dict[str, bool],
    *,
    headers: Dict[str, str],
    search_wikipedia_fn: Callable[[str, Dict[str, str], int], List[Dict[str, Any]]],
    search_duckduckgo_fn: Callable[[str, Dict[str, str], int], List[Dict[str, Any]]],
    search_google_fn: Callable[[str, Dict[str, str], int], List[Dict[str, Any]]],
    search_bing_fn: Callable[[str, Dict[str, str], int], List[Dict[str, Any]]],
    debug: Callable[[str], None],
) -> List[List[Dict[str, Any]]]:
    provider_results: List[List[Dict[str, Any]]] = []
    for provider_name, search_fn in (
        ("wikipedia", search_wikipedia_fn),
        ("duckduckgo", search_duckduckgo_fn),
        ("google", search_google_fn),
        ("bing", search_bing_fn),
    ):
        if not source_selection.get(provider_name):
            provider_results.append([])
            continue

        try:
            results = search_fn(query, headers, 5)
            debug(f"{provider_name.title()} returned {len(results)} results")
            provider_results.append(results)
        except Exception as error:
            debug(f"{provider_name.title()} failed: {error}")
            provider_results.append([])

    return provider_results


def interleave_result_lists(*result_groups: Sequence[Sequence[Dict[str, Any]]]) -> List[Dict[str, Any]]:
    groups = [list(group) for group in result_groups if group]
    merged: List[Dict[str, Any]] = []

    while any(groups):
        for group in groups:
            if group:
                merged.append(group.pop(0))

    return merged


def build_search_headers(
    *,
    choose_user_agent: Callable[[], str],
) -> Dict[str, str]:
    return {
        "User-Agent": choose_user_agent(),
        "Accept-Language": "en-US,en;q=0.9",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
        "Referer": "https://www.google.com/",
        "DNT": "1",
        "Upgrade-Insecure-Requests": "1",
        "Cache-Control": "max-age=0",
    }


def _clamp(value: float, minimum: float = 0.0, maximum: float = 1.0) -> float:
    return max(minimum, min(maximum, value))


def _sentence_count(text: str) -> int:
    return len([segment for segment in re.split(r"(?<=[.!?])\s+", text) if segment.strip()])


def _term_overlap(tokens: Sequence[str], focus_words: set[str]) -> float:
    token_set = set(tokens)
    if not token_set or not focus_words:
        return 0.0
    return len(token_set.intersection(focus_words)) / max(len(focus_words), 1)


def score_frontier_result(
    result: Dict[str, Any],
    query: str,
    *,
    query_words: Callable[[str], set[str]],
    expand_query_focus_words: Callable[[set[str]], set[str]],
    tokenize: Callable[[str], Sequence[str]],
    normalize_space: Callable[[Any], str],
    source_relevance: Callable[[Dict[str, Any], set[str]], float],
    feature_snapshot: Optional[Dict[str, float]] = None,
) -> float:
    q_words = query_words(query)
    focus_words = expand_query_focus_words(q_words)
    snapshot = feature_snapshot or build_quality_feature_snapshot(
        result,
        q_words,
        focus_words,
        tokenize=lambda text: list(tokenize(text)),
        normalize_space=normalize_space,
        source_relevance=source_relevance,
        clamp=_clamp,
    )

    title_overlap = float(snapshot.get("_title_focus_overlap", 0.0))
    content_overlap = float(snapshot.get("_content_focus_overlap", 0.0))
    relevance = source_relevance(result, q_words)
    definitional_density = float(snapshot.get("_definitional_density", 0.0))
    content_depth = float(snapshot.get("_content_depth", 0.0))
    spam_risk = float(snapshot.get("_spam_risk", 0.0))
    semantic_coherence = float(snapshot.get("_semantic_coherence", 0.0))
    authority_prior = _clamp(float(result.get("authorityScore", 0.5)), 0.0, 1.0)
    informative_prior = _clamp(float(result.get("informativeScore", 0.5)), 0.0, 1.0)
    fallback_weight = _clamp(float(result.get("_fallbackWeight", 1.0)), 0.0, 1.0)

    score = (
        relevance * 0.27
        + title_overlap * 0.16
        + content_overlap * 0.08
        + definitional_density * 0.16
        + authority_prior * 0.13
        + informative_prior * 0.06
        + content_depth * 0.12
        + semantic_coherence * 0.10
    )
    score -= spam_risk * 0.18
    score *= fallback_weight
    return round(max(score, 0.0), 6)


def rank_frontier_results(
    results: Sequence[Dict[str, Any]],
    query: str,
    *,
    query_words: Callable[[str], set[str]],
    expand_query_focus_words: Callable[[set[str]], set[str]],
    tokenize: Callable[[str], Sequence[str]],
    normalize_space: Callable[[Any], str],
    source_relevance: Callable[[Dict[str, Any], set[str]], float],
) -> List[Dict[str, Any]]:
    scored_results = []
    q_words = query_words(query)
    focus_words = expand_query_focus_words(q_words)
    for index, result in enumerate(results):
        feature_snapshot = build_quality_feature_snapshot(
            result,
            q_words,
            focus_words,
            tokenize=lambda text: list(tokenize(text)),
            normalize_space=normalize_space,
            source_relevance=source_relevance,
            clamp=_clamp,
        )
        score = score_frontier_result(
            result,
            query,
            query_words=query_words,
            expand_query_focus_words=expand_query_focus_words,
            tokenize=tokenize,
            normalize_space=normalize_space,
            source_relevance=source_relevance,
            feature_snapshot=feature_snapshot,
        )
        enriched = dict(result)
        enriched.update(feature_snapshot)
        enriched["_frontierScore"] = score
        scored_results.append((score, index, enriched))

    scored_results.sort(key=lambda item: (item[0], -item[1]), reverse=True)
    return [result for _, _, result in scored_results]


def evaluate_frontier_quality(
    results: Sequence[Dict[str, Any]],
    query: str,
    *,
    query_words: Callable[[str], set[str]],
    expand_query_focus_words: Callable[[set[str]], set[str]],
    tokenize: Callable[[str], Sequence[str]],
    normalize_space: Callable[[Any], str],
    source_relevance: Callable[[Dict[str, Any], set[str]], float],
) -> Dict[str, float]:
    q_words = query_words(query)
    focus_words = expand_query_focus_words(q_words)
    real_results = [result for result in results if not result.get("_isFallback")]

    if not real_results:
        return {
            "real_count": 0.0,
            "avg_frontier_score": 0.0,
            "avg_relevance": 0.0,
            "coverage_ratio": 0.0,
        }

    top_results = real_results[: min(6, len(real_results))]
    avg_frontier_score = sum(
        float(result.get("_frontierScore", 0.0)) or score_frontier_result(
            result,
            query,
            query_words=query_words,
            expand_query_focus_words=expand_query_focus_words,
            tokenize=tokenize,
            normalize_space=normalize_space,
            source_relevance=source_relevance,
        )
        for result in top_results
    ) / len(top_results)
    avg_relevance = sum(source_relevance(result, q_words) for result in top_results) / len(top_results)

    coverage_words = set()
    for result in top_results:
        result_words = set(tokenize(normalize_space(result.get("title", "")) + " " + normalize_space(result.get("content", ""))))
        coverage_words.update(result_words.intersection(focus_words))

    coverage_ratio = (
        len(coverage_words) / max(len(focus_words), 1)
        if focus_words
        else 1.0
    )

    return {
        "real_count": float(len(real_results)),
        "avg_frontier_score": round(avg_frontier_score, 6),
        "avg_relevance": round(avg_relevance, 6),
        "coverage_ratio": round(coverage_ratio, 6),
    }


def should_supplement_with_fallback(
    results: Sequence[Dict[str, Any]],
    query: str,
    *,
    query_words: Callable[[str], set[str]],
    expand_query_focus_words: Callable[[set[str]], set[str]],
    tokenize: Callable[[str], Sequence[str]],
    normalize_space: Callable[[Any], str],
    source_relevance: Callable[[Dict[str, Any], set[str]], float],
) -> Dict[str, float]:
    quality = evaluate_frontier_quality(
        results,
        query,
        query_words=query_words,
        expand_query_focus_words=expand_query_focus_words,
        tokenize=tokenize,
        normalize_space=normalize_space,
        source_relevance=source_relevance,
    )

    real_count = int(quality["real_count"])
    avg_frontier_score = quality["avg_frontier_score"]
    avg_relevance = quality["avg_relevance"]
    coverage_ratio = quality["coverage_ratio"]

    strong_real_frontier = (
        real_count >= 6
        and avg_frontier_score >= 0.40
        and avg_relevance >= 0.72
        and coverage_ratio >= 0.55
    )
    if strong_real_frontier:
        return {
            **quality,
            "should_use_fallback": 0.0,
            "desired_count": 0.0,
        }

    severe_shortage = real_count < 3
    shallow_frontier = avg_frontier_score < 0.40 and (avg_relevance < 0.68 or coverage_ratio < 0.48)
    weak_coverage = coverage_ratio < 0.35
    weak_relevance = avg_relevance < 0.36
    borderline_shortage = real_count < 6 and (
        avg_frontier_score < 0.54 or coverage_ratio < 0.50 or avg_relevance < 0.52
    )

    should_use = severe_shortage or shallow_frontier or weak_coverage or weak_relevance or borderline_shortage
    if not should_use:
        return {
            **quality,
            "should_use_fallback": 0.0,
            "desired_count": 0.0,
        }

    desired_count = max(0, 8 - real_count)
    if severe_shortage or shallow_frontier or weak_coverage:
        desired_count = max(desired_count, 6)
    if avg_frontier_score < 0.35 or coverage_ratio < 0.25:
        desired_count = max(desired_count, 8)

    desired_count = min(desired_count, 10)
    return {
        **quality,
        "should_use_fallback": 1.0,
        "desired_count": float(desired_count),
    }


def enrich_frontier_results(
    results: Sequence[Dict[str, Any]],
    query: str,
    *,
    headers: Dict[str, str],
    fetch_page_document_fn: Callable[..., Dict[str, Any]],
    query_words: Callable[[str], set[str]],
    expand_query_focus_words: Callable[[set[str]], set[str]],
    tokenize: Callable[[str], Sequence[str]],
    normalize_space: Callable[[Any], str],
    source_relevance: Callable[[Dict[str, Any], set[str]], float],
    debug: Callable[[str], None],
    limit: int = 6,
) -> List[Dict[str, Any]]:
    if not results:
        return list(results)
    ranked = rank_frontier_results(results, query, query_words=query_words, expand_query_focus_words=expand_query_focus_words, tokenize=tokenize, normalize_space=normalize_space, source_relevance=source_relevance)
    updates: Dict[str, Dict[str, Any]] = {}
    for result in ranked:
        providers = [normalize_space(provider).lower() for provider in (result.get("searchProviders", []) or []) if normalize_space(provider)]
        primary = normalize_space(result.get("searchProvider", "")).lower()
        if primary and primary not in providers:
            providers.insert(0, primary)
        url = normalize_http_url(result.get("url", "")) or _cached_normalize_space(result.get("url", "")).lower()
        content = normalize_space(result.get("content", ""))
        if not url or url in updates or not can_fetch_page(url) or result.get("_isFallback"):
            continue
        if "manual" in providers or "wikipedia" in providers:
            continue
        if len(content) >= 820 and len(_split_search_sentences(content)) >= 5:
            continue
        if len(updates) >= limit:
            break
        try:
            document = fetch_page_document_fn(url, headers, max_chars=2200)
        except TypeError:
            document = fetch_page_document_fn(url, headers)
        except Exception as error:
            debug(f"Page enrichment failed for {url}: {error}")
            continue
        page_content = normalize_space((document or {}).get("content", ""))
        if not page_content:
            continue
        merged = _merge_evidence_text(content, page_content, max_chars=2200)
        if len(merged) <= len(content) + 40:
            continue
        updated = dict(result)
        updated["content"] = merged
        if "page-fetch" not in providers:
            providers.append("page-fetch")
        updated["searchProviders"] = providers
        updates[url] = updated
    if not updates:
        return list(results)
    debug(f"Enriched {len(updates)} frontier results with direct page excerpts")
    return [dict(updates.get(normalize_http_url(result.get("url", "")) or _cached_normalize_space(result.get("url", "")).lower(), result)) for result in results]


def search_web_results(
    query: str,
    source_config: Any = None,
    *,
    normalize_source_config: Callable[[Any], Dict[str, Any]],
    query_words: Callable[[str], set],
    expand_query_focus_words: Callable[[set[str]], set[str]],
    tokenize: Callable[[str], Sequence[str]],
    normalize_space: Callable[[Any], str],
    source_relevance: Callable[[Dict[str, Any], set[str]], float],
    perform_search: Callable[[str, Dict[str, bool]], Sequence[Sequence[Dict[str, Any]]]],
    fetch_manual_sources: Callable[[Sequence[str], Dict[str, str]], Sequence[Dict[str, Any]]],
    dedupe_results: Callable[[Sequence[Dict[str, Any]], str], Sequence[Dict[str, Any]]],
    get_fallback_query: Callable[[str], str],
    results_miss_query_focus: Callable[[str, Sequence[Dict[str, Any]], set], bool],
    build_adaptive_fallback_results: Callable[[str, Sequence[Dict[str, Any]], int], Sequence[Dict[str, Any]]],
    choose_user_agent: Callable[[], str],
    fetch_page_document: Callable[..., Dict[str, Any]],
    debug: Callable[[str], None],
) -> Sequence[Dict[str, Any]]:
    normalized_source_config = normalize_source_config(source_config)
    source_selection = normalized_source_config["sources"]
    manual_urls = normalized_source_config["manualUrls"]
    disable_mock_fallback = normalized_source_config["disableMockFallback"]
    q_words = query_words(query)

    provider_results = list(perform_search(query, source_selection))

    if not any(provider_results[1:]):
        fallback_query = get_fallback_query(query)
        if fallback_query != query:
            debug(f"Initial search failed for external providers. Retrying with fallback: {fallback_query}")
            fallback_results = list(perform_search(fallback_query, source_selection))
            for index in range(1, min(len(provider_results), len(fallback_results))):
                if fallback_results[index]:
                    provider_results[index] = fallback_results[index]

    combined_preview = interleave_result_lists(*provider_results)
    focused_provider_results = []
    focused_query = get_fallback_query(query)
    if focused_query != query and results_miss_query_focus(query, combined_preview, q_words):
        debug(f"Query focus missing in initial results. Retrying with focused query: {focused_query}")
        focused_provider_results = list(perform_search(focused_query, source_selection))

    if manual_urls:
        manual_headers = {"User-Agent": choose_user_agent()}
        provider_results.append(list(fetch_manual_sources(manual_urls, manual_headers)))

    combined_results = interleave_result_lists(*provider_results, *focused_provider_results)
    normalized_results = list(dedupe_results(combined_results, query))
    if normalized_results:
        wikipedia_baseline = [
            result
            for result in normalized_results
            if str(result.get("searchProvider", "")).lower() == "wikipedia"
            or "wikipedia" in [str(provider).lower() for provider in (result.get("searchProviders", []) or [])]
        ]
        filtered_results = semantic_cooccurrence_filter(
            query,
            normalized_results,
            baseline_documents=wikipedia_baseline[:4] or normalized_results[:2],
            min_similarity=0.16 if wikipedia_baseline else 0.12,
            keep_min=min(3, max(1, len(normalized_results) // 4)),
        )
        if filtered_results:
            if len(filtered_results) < len(normalized_results):
                debug(
                    "Semantic co-occurrence filter retained "
                    f"{len(filtered_results)} of {len(normalized_results)} frontier results"
                )
            normalized_results = filtered_results

    if normalized_results:
        normalized_results = list(dedupe_results(
            enrich_frontier_results(
                normalized_results,
                query,
                headers=build_search_headers(choose_user_agent=choose_user_agent),
                fetch_page_document_fn=fetch_page_document,
                query_words=query_words,
                expand_query_focus_words=expand_query_focus_words,
                tokenize=tokenize,
                normalize_space=normalize_space,
                source_relevance=source_relevance,
                debug=debug,
            ),
            query,
        ))

    ranked_results = rank_frontier_results(
        normalized_results,
        query,
        query_words=query_words,
        expand_query_focus_words=expand_query_focus_words,
        tokenize=tokenize,
        normalize_space=normalize_space,
        source_relevance=source_relevance,
    )[:18]

    fallback_decision = should_supplement_with_fallback(
        ranked_results,
        query,
        query_words=query_words,
        expand_query_focus_words=expand_query_focus_words,
        tokenize=tokenize,
        normalize_space=normalize_space,
        source_relevance=source_relevance,
    )

    if not bool(fallback_decision["should_use_fallback"]) and ranked_results:
        return ranked_results

    if disable_mock_fallback and ranked_results:
        return ranked_results
    if disable_mock_fallback:
        return []

    desired_fallback_count = int(fallback_decision["desired_count"]) or max(6, 10 - len(ranked_results))
    adaptive_results = list(build_adaptive_fallback_results(query, ranked_results, desired_fallback_count))
    final_results = list(dedupe_results(list(ranked_results) + adaptive_results, query))
    return rank_frontier_results(
        final_results,
        query,
        query_words=query_words,
        expand_query_focus_words=expand_query_focus_words,
        tokenize=tokenize,
        normalize_space=normalize_space,
        source_relevance=source_relevance,
    )[:18]
