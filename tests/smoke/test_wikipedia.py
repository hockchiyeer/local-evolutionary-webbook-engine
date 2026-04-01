
import urllib.parse
import urllib.request
import json
import re
import html

SEARCH_REQUEST_TIMEOUT = 10

def normalize_space(text):
    return re.sub(r"\s+", " ", str(text or "")).strip()

def strip_tags(html_text):
    return re.sub(r'<[^>]+>', '', html_text)

def search_wikipedia(query, headers, limit=5):
    encoded_query = urllib.parse.quote(query)
    search_url = f"https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch={encoded_query}&utf8=&format=json&srlimit={limit}"
    req = urllib.request.Request(search_url, headers=headers)
    with urllib.request.urlopen(req, timeout=SEARCH_REQUEST_TIMEOUT) as response:
        data = json.loads(response.read().decode('utf-8'))

    search_results = data.get('query', {}).get('search', [])
    page_ids = [str(item.get('pageid')) for item in search_results if item.get('pageid')]
    page_extracts = {}

    if page_ids:
        extract_url = (
            "https://en.wikipedia.org/w/api.php?action=query&prop=extracts&exintro=1&explaintext=1"
            f"&pageids={'|'.join(page_ids)}&format=json"
        )
        try:
            ex_req = urllib.request.Request(extract_url, headers=headers)
            with urllib.request.urlopen(ex_req, timeout=SEARCH_REQUEST_TIMEOUT) as ex_res:
                ex_data = json.loads(ex_res.read().decode('utf-8'))
                pages = ex_data.get('query', {}).get('pages', {})
                page_extracts = {
                    page_id: normalize_space(page_info.get('extract', ''))
                    for page_id, page_info in pages.items()
                }
        except Exception as e:
            print(f"Error fetching extracts: {e}")
            page_extracts = {}

    results = []

    for item in search_results:
        title = normalize_space(item.get('title', ''))
        page_id = item.get('pageid')
        snippet = normalize_space(strip_tags(item.get('snippet', '')))
        content = page_extracts.get(str(page_id), snippet)

        if not content or len(content) < 50:
            content = snippet

        results.append({
            "url": f"https://en.wikipedia.org/?curid={page_id}",
            "title": title,
            "content": content,
            "searchProvider": "wikipedia",
        })

    return results

headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
}

if __name__ == "__main__":
    query = "outlook for the malaysian stock market over the next one year"
    results = search_wikipedia(query, headers)
    for r in results:
        print(f"Title: {r['title']}")
        print(f"URL: {r['url']}")
        print(f"Content: {r['content'][:200]}...")
        print("-" * 20)
