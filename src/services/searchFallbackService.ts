import type { SearchFallbackPayload } from "../types";

const SEARCH_FALLBACK_ROUTE = "/api/search-fallback";
const FALLBACK_FETCH_ATTEMPTS = 3;
const FALLBACK_FETCH_TIMEOUT_MS = 20000;

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export async function fetchSearchFallback(query: string): Promise<SearchFallbackPayload> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= FALLBACK_FETCH_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(`${SEARCH_FALLBACK_ROUTE}?query=${encodeURIComponent(query)}`, {
        signal: AbortSignal.timeout(FALLBACK_FETCH_TIMEOUT_MS),
      });

      if (!response.ok) {
        let errorMessage = "Supplemental live search is currently unavailable.";

        try {
          const payload = (await response.json()) as { error?: string };
          if (payload.error) {
            errorMessage = payload.error;
          }
        } catch {
          // Ignore JSON parsing errors and keep the generic message.
        }

        throw new Error(errorMessage);
      }

      return (await response.json()) as SearchFallbackPayload;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error("Supplemental live search request failed.");

      if (attempt < FALLBACK_FETCH_ATTEMPTS) {
        await wait(700 * attempt);
      }
    }
  }

  throw lastError ?? new Error("Supplemental live search is currently unavailable.");
}
