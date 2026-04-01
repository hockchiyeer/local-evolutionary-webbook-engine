# Verified Current-State Summary

This file summarizes what the current checkout directly supports. It does not attempt to reconstruct historical changes because this workspace is not a Git repository.

## Verified Application Structure
- The project is a full-stack application with an Express server in `server.ts`, a Python engine in `evolution_engine.py`, and a React frontend in `src/`.
- The server exposes `/api/search`, `/api/evolve`, and `/api/assemble`, and uses Vite middleware during development.
- The frontend service layer calls those API routes instead of talking directly to a model SDK.
- A source search of the current tree found no `@google/genai` or `Gemini` references in application code, but this checkout alone does not prove when or how that changed.

## Verified Backend and Engine Behavior
- Python output is protected from stdout noise with `contextlib.redirect_stdout(sys.stderr)` and a dedicated `print_json` helper.
- The search pipeline performs live external requests to Wikipedia, DuckDuckGo, Google, and Bing. Ranking, evolution, and assembly run locally in Python, but the overall system is not fully local or offline.
- Search behavior includes user-agent rotation, randomized delays, focused fallback-query shaping, and CAPTCHA or bot-detection logging.
- Query-focus validation is implemented with overlap thresholds before retrying focused searches.
- The evolution pipeline includes custom selection, crossover, mutation, fitness scoring, and fitness caching.
- Population size and generation count are adjusted for smaller and larger result sets.
- Internal underscore-prefixed fields are recursively stripped before JSON is returned to the caller.
- The current server still registers `proc.on("error")` in more than one place, so this file does not claim duplicate handler elimination.

## Verified Frontend Behavior
- The UI tracks `searching`, `evolving`, `assembling`, and `complete` states.
- The frontend includes an artifacts panel, progress messaging, and an active processing indicator.
- The export flow includes `oklab` and `oklch` sanitization for PDF capture and a `window.print()` path for print-based export.
- Many interactive elements include `id` attributes for accessibility or testability, but not all interactive elements do.
- Chapter images are fetched from `https://picsum.photos`, so generated output still depends on an external image source.

## Verified Search and Ranking Notes
- The current ranking logic is based on generic query overlap, title and content focus, anchor-term boosting, quality features, and fallback weighting.
- This summary does not claim geography-specific or company-specific weighting such as Malaysia, KLSE, Bursa, London, or NYSE because those rules are not present in the current implementation.

## Verification Run In This Workspace
- `npm run build` completed successfully.
- `python -m pytest -q` passed with `50 passed`.

## Scope Notes
- This is a verified current-state summary, not a historical changelog.