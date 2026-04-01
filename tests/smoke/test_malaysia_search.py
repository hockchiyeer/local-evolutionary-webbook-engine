import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from evolution_engine import search_web

query = "outlook for the malaysian stock market over the next one year"
source_config = {
    "sources": {
        "wikipedia": True,
        "duckduckgo": True,
        "google": True,
        "bing": True
    },
    "manualUrls": [],
    "disableMockFallback": False
}

if __name__ == "__main__":
    print(f"Searching for: {query}")
    results = search_web(query, source_config)

    print(f"Found {len(results)} results.")
    for i, res in enumerate(results[:5]):
        print(f"Result {i+1}:")
        print(f"  Title: {res.get('title')}")
        print(f"  URL: {res.get('url')}")
        print(f"  Provider: {res.get('searchProvider')}")
        print("-" * 20)
