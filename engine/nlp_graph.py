"""Local morpho-semantic graph utilities backed by NetworkX when available."""

from __future__ import annotations

from collections import deque
from functools import lru_cache
import re
from typing import Any, Dict, Iterable, List, Sequence, Set, Tuple

try:
    import networkx as nx

    NETWORKX_AVAILABLE = True
except Exception:
    nx = None
    NETWORKX_AVAILABLE = False


TOKEN_PATTERN = re.compile(r"[a-z0-9']{2,}")

_SEMANTIC_ALIASES: Dict[str, Set[str]] = {
    "stock market": {
        "stock market",
        "stock exchange",
        "equity market",
        "equities exchange",
        "securities market",
    },
    "malaysian stock market": {
        "malaysian stock market",
        "malaysia equities",
        "malaysian equities",
        "bursa malaysia",
        "malaysia exchange",
    },
    "capital market": {"capital market", "capital markets"},
    "foreign investment": {"foreign investment", "foreign inflows", "capital inflows"},
    "commodity pricing": {"commodity pricing", "commodity prices", "commodity cycle"},
    "regulatory policy": {"regulatory policy", "market regulation", "regulation"},
    "market liquidity": {"market liquidity", "liquidity conditions"},
    "valuation multiples": {"valuation multiples", "market valuation", "earnings multiples"},
    "dividend yields": {"dividend yields", "dividend yield"},
    "listed companies": {"listed companies", "public companies", "listed firms"},
    "artificial intelligence": {
        "artificial intelligence",
        "ai",
        "machine intelligence",
        "intelligent systems",
    },
    "machine learning": {"machine learning", "ml"},
    "frontier models": {"frontier models", "foundation models", "large models"},
    "compute infrastructure": {"compute infrastructure", "compute capacity", "accelerator infrastructure"},
    "application domains": {"application domains", "high-value application domains", "use cases"},
    "model governance": {"model governance", "ai governance", "governance"},
    "risk mitigation": {"risk mitigation", "risk controls", "safety controls"},
    "capability building": {"capability building", "organizational capability", "institutional capacity"},
    "investment flows": {"investment flows", "capital allocation", "funding flows"},
    "grid resilience": {"grid resilience", "grid resilience planning", "resilience planning"},
    "emergency response": {"emergency response", "incident response"},
    "asset hardening": {"asset hardening", "infrastructure hardening"},
    "restoration priorities": {"restoration priorities", "recovery priorities"},
    "continuity metrics": {"continuity metrics", "resilience metrics"},
    "reactor supply chain": {"reactor supply chain", "advanced reactor supply chains", "nuclear supply chain"},
    "manufacturing capacity": {"manufacturing capacity", "industrial capacity"},
    "component qualification": {"component qualification", "supplier qualification"},
    "fuel services": {"fuel services", "fuel supply"},
    "nuclear deployment": {"nuclear deployment", "reactor deployment"},
    "biography": {"biography", "biographical background", "background and identity"},
    "career milestones": {"career milestones", "career", "professional trajectory"},
    "leadership": {"leadership", "leadership and governance"},
    "legacy": {"legacy", "historical legacy"},
    "public office": {"public office", "state office", "government office"},
    "policy reform": {"policy reform", "reform agenda", "public policy"},
    "economy": {"economy", "economic outlook"},
    "domestic demand": {"domestic demand", "household demand"},
    "exports": {"exports", "export growth"},
    "currency stability": {"currency stability", "exchange-rate stability"},
}

_SEMANTIC_RELATIONS: Tuple[Tuple[str, str, str], ...] = (
    ("malaysian stock market", "stock market", "is_a"),
    ("malaysian stock market", "bursa malaysia", "synonym"),
    ("stock market", "capital market", "broader"),
    ("stock market", "listed companies", "related"),
    ("stock market", "market liquidity", "related"),
    ("stock market", "valuation multiples", "related"),
    ("stock market", "dividend yields", "related"),
    ("stock market", "foreign investment", "related"),
    ("stock market", "commodity pricing", "related"),
    ("stock market", "regulatory policy", "related"),
    ("foreign investment", "capital market", "related"),
    ("commodity pricing", "exports", "related"),
    ("regulatory policy", "capital market", "related"),
    ("market liquidity", "valuation multiples", "related"),
    ("artificial intelligence", "machine learning", "related"),
    ("artificial intelligence", "frontier models", "related"),
    ("artificial intelligence", "compute infrastructure", "related"),
    ("artificial intelligence", "application domains", "related"),
    ("artificial intelligence", "model governance", "related"),
    ("artificial intelligence", "risk mitigation", "related"),
    ("artificial intelligence", "capability building", "related"),
    ("artificial intelligence", "investment flows", "related"),
    ("frontier models", "compute infrastructure", "dependency"),
    ("frontier models", "application domains", "related"),
    ("model governance", "risk mitigation", "related"),
    ("capability building", "model governance", "dependency"),
    ("investment flows", "compute infrastructure", "related"),
    ("grid resilience", "emergency response", "related"),
    ("grid resilience", "asset hardening", "related"),
    ("grid resilience", "restoration priorities", "related"),
    ("grid resilience", "continuity metrics", "related"),
    ("reactor supply chain", "manufacturing capacity", "related"),
    ("reactor supply chain", "component qualification", "related"),
    ("reactor supply chain", "fuel services", "related"),
    ("reactor supply chain", "nuclear deployment", "outcome"),
    ("biography", "career milestones", "related"),
    ("biography", "leadership", "related"),
    ("biography", "legacy", "related"),
    ("leadership", "public office", "related"),
    ("leadership", "policy reform", "related"),
    ("economy", "domestic demand", "related"),
    ("economy", "exports", "related"),
    ("economy", "currency stability", "related"),
    ("economy", "foreign investment", "related"),
)


def _normalize_key(text: str) -> str:
    return re.sub(r"\s+", " ", str(text or "")).strip().lower()


def _tokenize(text: str) -> List[str]:
    return TOKEN_PATTERN.findall(_normalize_key(text))


def _add_edge(
    graph: Any,
    adjacency: Dict[str, Dict[str, Dict[str, Any]]],
    left: str,
    right: str,
    relation: str,
) -> None:
    if left == right:
        return
    adjacency.setdefault(left, {})[right] = {"relation": relation}
    adjacency.setdefault(right, {})[left] = {"relation": relation}
    if NETWORKX_AVAILABLE and graph is not None:
        graph.add_edge(left, right, relation=relation)


@lru_cache(maxsize=1)
def _graph_payload() -> Dict[str, Any]:
    graph = nx.Graph() if NETWORKX_AVAILABLE else None
    adjacency: Dict[str, Dict[str, Dict[str, Any]]] = {}
    alias_to_node: Dict[str, str] = {}

    for canonical, aliases in _SEMANTIC_ALIASES.items():
        normalized_canonical = _normalize_key(canonical)
        alias_to_node[normalized_canonical] = normalized_canonical
        if NETWORKX_AVAILABLE and graph is not None:
            graph.add_node(normalized_canonical)
        adjacency.setdefault(normalized_canonical, {})

        for alias in aliases:
            normalized_alias = _normalize_key(alias)
            alias_to_node[normalized_alias] = normalized_canonical
            if normalized_alias != normalized_canonical:
                _add_edge(graph, adjacency, normalized_canonical, normalized_alias, "synonym")

    for left, right, relation in _SEMANTIC_RELATIONS:
        left_key = alias_to_node.get(_normalize_key(left), _normalize_key(left))
        right_key = alias_to_node.get(_normalize_key(right), _normalize_key(right))
        if NETWORKX_AVAILABLE and graph is not None:
            graph.add_node(left_key)
            graph.add_node(right_key)
        _add_edge(graph, adjacency, left_key, right_key, relation)

    return {
        "graph": graph,
        "adjacency": adjacency,
        "alias_to_node": alias_to_node,
    }


def _match_seed_nodes(text: str) -> List[str]:
    normalized = _normalize_key(text)
    if not normalized:
        return []

    payload = _graph_payload()
    alias_to_node = payload["alias_to_node"]
    tokens = set(_tokenize(normalized))
    matches: List[str] = []

    for alias in sorted(alias_to_node.keys(), key=len, reverse=True):
        alias_tokens = set(_tokenize(alias))
        if not alias_tokens:
            continue
        if alias in normalized:
            matches.append(alias_to_node[alias])
            continue
        overlap_ratio = len(alias_tokens.intersection(tokens)) / len(alias_tokens)
        if overlap_ratio >= 0.8:
            matches.append(alias_to_node[alias])

    if matches:
        return list(dict.fromkeys(matches))

    for node in payload["adjacency"].keys():
        node_tokens = set(_tokenize(node))
        if node_tokens and len(node_tokens.intersection(tokens)) >= min(len(node_tokens), 2):
            matches.append(node)

    return list(dict.fromkeys(matches))


def _distance_between(seed_nodes: Sequence[str], candidate_nodes: Sequence[str]) -> int | None:
    if not seed_nodes or not candidate_nodes:
        return None

    payload = _graph_payload()
    graph = payload["graph"]
    adjacency = payload["adjacency"]
    best_distance: int | None = None

    for seed in seed_nodes:
        for candidate in candidate_nodes:
            if seed == candidate:
                return 0

            distance: int | None = None
            if NETWORKX_AVAILABLE and graph is not None:
                try:
                    distance = int(nx.shortest_path_length(graph, seed, candidate))
                except Exception:
                    distance = None
            else:
                seen = {seed}
                queue = deque([(seed, 0)])
                while queue:
                    current, current_distance = queue.popleft()
                    if current == candidate:
                        distance = current_distance
                        break
                    for neighbor in adjacency.get(current, {}):
                        if neighbor in seen:
                            continue
                        seen.add(neighbor)
                        queue.append((neighbor, current_distance + 1))

            if distance is None:
                continue
            if best_distance is None or distance < best_distance:
                best_distance = distance

    return best_distance


def expand_semantic_phrases(text: str, max_depth: int = 2, limit: int = 12) -> List[str]:
    seed_nodes = _match_seed_nodes(text)
    if not seed_nodes:
        return []

    payload = _graph_payload()
    graph = payload["graph"]
    adjacency = payload["adjacency"]
    scored_nodes: List[Tuple[int, str]] = []
    seen = set()

    for seed in seed_nodes:
        if NETWORKX_AVAILABLE and graph is not None:
            try:
                lengths = nx.single_source_shortest_path_length(graph, seed, cutoff=max_depth)
            except Exception:
                lengths = {seed: 0}
        else:
            lengths = {seed: 0}
            queue = deque([(seed, 0)])
            while queue:
                current, current_distance = queue.popleft()
                if current_distance >= max_depth:
                    continue
                for neighbor in adjacency.get(current, {}):
                    next_distance = current_distance + 1
                    previous = lengths.get(neighbor)
                    if previous is not None and previous <= next_distance:
                        continue
                    lengths[neighbor] = next_distance
                    queue.append((neighbor, next_distance))

        for node, distance in lengths.items():
            if node in seen:
                continue
            seen.add(node)
            scored_nodes.append((distance, node))

    scored_nodes.sort(key=lambda item: (item[0], len(item[1]), item[1]))
    return [node for _, node in scored_nodes[:limit]]


def expand_semantic_terms(text: str, max_depth: int = 1, limit: int = 20) -> Set[str]:
    phrases = expand_semantic_phrases(text, max_depth=max_depth, limit=limit)
    terms: Set[str] = set()
    for phrase in phrases:
        for token in _tokenize(phrase):
            if len(token) >= 3:
                terms.add(token)
    return terms


def concept_crawl_depth(seed: str, nodes: Iterable[str]) -> List[Dict[str, Any]]:
    seed_key = _normalize_key(seed)
    seed_nodes = _match_seed_nodes(seed_key)
    seed_tokens = set(_tokenize(seed_key))
    depth_map: List[Dict[str, Any]] = []

    for node in nodes:
        node_key = _normalize_key(node)
        candidate_nodes = _match_seed_nodes(node_key)
        distance = _distance_between(seed_nodes, candidate_nodes)

        if distance is None:
            node_tokens = set(_tokenize(node_key))
            overlap = len(seed_tokens.intersection(node_tokens)) / max(len(node_tokens), 1) if node_tokens else 0.0
            if node_key == seed_key or overlap >= 0.8:
                distance = 0
            elif overlap >= 0.3:
                distance = 1

        if distance is None:
            layer = "tangential"
        elif distance == 0:
            layer = "seed"
        elif distance <= 2:
            layer = "related"
        else:
            layer = "tangential"

        depth_map.append(
            {
                "node": node,
                "canonicalNode": candidate_nodes[0] if candidate_nodes else node_key,
                "distance": distance,
                "layer": layer,
            }
        )

    return depth_map
