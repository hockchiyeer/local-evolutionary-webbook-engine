# Multi Source Evolutionary Webbook Engine

A commercial API-independent Web application that turns a queried topic into a structured "web-book" by combining a React frontend, an Express development server, and a local Python-based evolutionary synthesis engine.

👉 You can explore the live application built from this repository’s source code at: [https://ai.studio/apps/e65be886-741c-4062-9a9c-9f589f240948?fullscreenApplet=true](https://ai.studio/apps/e65be886-741c-4062-9a9c-9f589f240948?fullscreenApplet=true)

The project does not depend on commercial LLM APIs, cloud AI APIs, or hosted model providers. Its content pipeline is driven by a local evolutionary engine that searches public sources, scores relevance and redundancy, evolves a compact source set, and assembles a 10-chapter book-like reading experience. It now also includes an offline semantic layer backed by local open-source NLP tooling and a broad benchmark/regression harness for backend quality tracking.

## What This Repo Does

- Generates a multi-chapter web-book for a user-supplied topic.
- Uses a local Python evolutionary engine instead of a commercial AI API.
- Combines Wikipedia, DuckDuckGo, Google, and Bing source discovery by default, then falls back to adaptive local synthetic sources when external access is unavailable.
- Scores sources by relevance, informativeness, authority, and redundancy.
- Builds a styled reading interface with a cover, table of contents, chapter pages, glossary blocks, and chapter source references.
- Provides a source portal so users can opt search providers in or out and add manual source URLs.
- Persists generated books in browser `localStorage` for quick revisit through the history panel.
- Supports export to PDF, Word-compatible HTML, standalone HTML, and plain text.

## Current Features

- `Targeted ingestion`: topic-driven search across Wikipedia, DuckDuckGo, Google, and Bing with normalized source extraction.
- `Source portal`: per-provider opt-in/opt-out controls plus manual URL entry for custom sources.
- `Evolutionary processing`: redundancy-aware source selection with greedy seeding, crossover, mutation, and fitness scoring.
- `Offline semantic analysis`: local semantic coherence and clustering signals using open-source `scikit-learn`, with no hosted inference dependency.
- `Entity-aware fallback`: generic archetype-aware fallback and chapter shaping so person-name queries degrade into biography-style synthesis instead of abstract generic filler.
- `Web-book assembly`: converts evolved sources into a 10-chapter book with chapter text, definitions, sub-topics, visual seeds, and source citations.
- `Readable rendering`: filters noisy glossary/sub-topic content before display and computes render/page plans for the formatted book view.
- `Export options`: PDF, `.doc`, `.html`, and `.txt`.
- `History archive`: local browser history with per-book reopen and delete support.
- `Defensive error handling`: better handling for non-JSON backend errors and Python process startup failures.
- `Benchmark and regression coverage`: backend contract tests, pipeline regressions, GA operator tests, organization regression checks, and a broad synthetic benchmark library with tag-based packs.

## Architecture

The app is split into three layers:

1. `React + Vite frontend`
   Renders the UI, collects the topic, displays the generated web-book, and manages exports/history.
2. `Express bridge server`
   Hosts the Vite app in development and exposes `/api/search`, `/api/evolve`, and `/api/assemble`.
3. `Python evolutionary engine`
   Performs source retrieval, normalization, feature extraction, fitness scoring, source evolution, semantic clustering, benchmarking, and chapter assembly.

Request flow:

1. The browser submits a topic.
2. `src/services/evolutionService.ts` calls the local Express API.
3. `server.ts` starts `evolution_engine.py` and passes structured payloads through `stdin`.
4. The Python engine returns JSON to the server.
5. The frontend renders the generated web-book and enables export/history actions.

## File And Folder Structure

Key repo files and folders:

```text
.
|-- engine/
|   |-- archetypes.py
|   |-- benchmarks.py
|   |-- contracts.py
|   |-- fallback.py
|   |-- features.py
|   |-- fitness.py
|   |-- ga.py
|   |-- nlp.py
|   |-- normalize.py
|   |-- organize.py
|   |-- search.py
|   `-- titles.py
|-- src/
|   |-- App.tsx
|   |-- main.tsx
|   |-- index.css
|   |-- types.ts
|   |-- services/
|   |   `-- evolutionService.ts
|   `-- utils/
|       `-- webBookRender.ts
|-- evolution_engine.py
|-- server.ts
|-- tests/
|   |-- integration/
|   |   |-- test_benchmark_queries.py
|   |   |-- test_engine_contracts.py
|   |   |-- test_fallback.py
|   |   |-- test_pipeline_regression.py
|   |   `-- test_query_focus.py
|   |-- smoke/
|   |   |-- test_malaysia_search.py
|   |   |-- test_python.py
|   |   `-- test_wikipedia.py
|   `-- unit/
|       |-- test_features.py
|       |-- test_fitness.py
|       |-- test_ga.py
|       |-- test_nlp.py
|       |-- test_organize.py
|       |-- test_search_normalize.py
|       `-- test_webbook_titles.py
|-- index.html
|-- vite.config.ts
|-- tsconfig.json
|-- package.json
|-- package-lock.json
|-- requirements.txt
|-- .env.example
|-- .gitignore
|-- CHANGELOG.md
|-- metadata.json
`-- README.md
```

What each important file is responsible for:

- `src/App.tsx`
  Main UI, search workflow, progress states, history drawer, book rendering, and export actions.
- `src/services/evolutionService.ts`
  Frontend API client for `/api/search`, `/api/evolve`, and `/api/assemble`.
- `src/utils/webBookRender.ts`
  Render-time quality filters for definitions and sub-topics plus chapter pagination/render plans.
- `src/types.ts`
  Shared TypeScript types for books, chapters, definitions, sub-topics, and source references.
- `server.ts`
  Express server that proxies the frontend workflow into the Python engine.
- `evolution_engine.py`
  Thin orchestration/CLI adapter for search, evolve, and assemble modes.
- `engine/search.py`
  Search provider retrieval, manual-source fetching, page readability extraction, frontier ranking, and fallback gating.
- `engine/archetypes.py`
  Generic query-archetype inference used to keep fallback generation and chapter organization topic-agnostic while still recognizing person-like entity queries.
- `engine/features.py`
  Internal cached feature signals including definitional density, spam risk, content depth, and semantic coherence.
- `engine/fitness.py`
  Bounded composite fitness scoring used by the GA.
- `engine/ga.py`
  Population seeding, tournament selection, crossover, mutation, elitism, and convergence control.
- `engine/organize.py`
  Cluster-aware chapter organization and source grouping.
- `engine/nlp.py`
  Offline semantic helper layer backed by local open-source `scikit-learn`.
- `engine/benchmarks.py`
  Extensible synthetic benchmark library and summary metrics for backend quality tracking.
- `tests/`
  Python test suite organized into `unit`, `integration`, and `smoke` subfolders.
- `index.html`
  Root HTML shell and the `html2pdf` CDN include used for PDF export.
- `vite.config.ts`
  Vite config with React and Tailwind integration.
- `requirements.txt`
  Local Python dependency list for the offline semantic layer.
- `.env.example`
  Minimal environment template. No commercial API key is required.

## Technical Stack

### Frontend

- React 19
- TypeScript
- Vite 6
- Tailwind CSS 4
- Motion
- Lucide React

### Backend / Runtime

- Node.js
- Express 4
- CORS middleware
- `tsx` for running `server.ts` in development
- Python 3 for `evolution_engine.py`

### Data / Content Pipeline

- Wikipedia API for encyclopedic topic lookup
- DuckDuckGo HTML search for broader public web-source discovery
- Google HTML search for additional public web-result coverage
- Bing search for alternative ranking and source diversity
- User-supplied manual URLs fetched directly into the source pool
- Local evolutionary + NLP layers for:
  - source normalization
  - benchmark scoring
  - semantic coherence
  - semantic clustering
  - glossary extraction
  - sub-topic extraction
  - redundancy detection
  - fitness scoring
  - chapter assembly
- Local adaptive fallback generation when network lookup is unavailable
- Offline `scikit-learn` semantic similarity and latent topic signals

### Export / Presentation Dependencies

- `html2pdf.js` loaded via CDN for PDF export
- browser-generated Blob downloads for `.txt`, `.html`, and `.doc`
- Google Fonts for the UI typography
- Picsum image seeds for chapter imagery

## Evolution Engine Details

The Python engine currently performs these stages:

1. `Search`
   Fetches and merges results from the enabled providers: Wikipedia, DuckDuckGo, Google, Bing, and any manual URLs supplied through the source portal.
2. `Source cleanup`
   Removes duplicate or low-signal concepts and builds fallback definitions/sub-topics when needed.
3. `Feature extraction`
   Computes cached quality signals including:
   - query relevance
   - definitional density
   - spam/repetition risk
   - content depth
   - semantic coherence
   - source trust
4. `Fitness evaluation`
   Scores candidate source sets using:
   - query relevance
   - informative score
   - authority score
   - concept diversity
   - semantic coherence bonus
   - redundancy penalties
   - spam penalties
5. `Evolution`
   Uses greedy seeding plus crossover, mutation, and tournament-style selection.
6. `Organization`
   Groups evolved sources into cluster-aware chapter themes before assembly.
7. `Assembly`
   Synthesizes a 10-chapter web-book with chapter text, glossary items, sub-topics, visual seeds, and source links.
8. `Benchmarking and regression`
   Runs synthetic offline benchmark packs and backend regression suites to keep quality measurable without any live network dependency.

## Setup

### Prerequisites

- Node.js
- npm
- Python 3 available on your `PATH` as `python`

### Install

```bash
npm install
python -m pip install -r requirements.txt
```

### Environment

Copy or review `.env.example` if needed:

```env
APP_URL="MY_APP_URL"
```

Notes:

- No commercial AI or LLM API key is required.
- No commercial model provider, cloud inference API, or hosted embedding service is used anywhere in the repo.
- `APP_URL` is optional for local development.

## Development

Start the app:

```bash
npm run dev
```

The development server runs at:

```text
http://localhost:3000
```

Helpful scripts:

```bash
npm run dev
npm run lint
npm run build
npm run preview
python -m unittest discover
```

## How To Use

1. Start the local dev server.
2. Enter a topic in the search box.
3. Adjust the source portal if you want to disable providers or add manual URLs.
4. Let the app complete search, evolution, and assembly.
5. Read the generated web-book in the main panel.
6. Reopen saved books from the history panel or export the current result.

Request time budgets:

- `search`
  The frontend and backend allow up to 3 minutes for complex retrieval and fallback orchestration.
- `evolve` and `assemble`
  The frontend and backend allow up to 5 minutes for heavier synthesis steps.

## Export Behavior

- `PDF`
  Uses `html2pdf.js` when available and can fall back to browser print behavior.
- `Word (.doc)`
  Exports a Word-compatible HTML document with embedded styling.
- `HTML`
  Exports a standalone HTML page containing the rendered book.
- `TXT`
  Exports a plain text version of the generated book.

## Benchmark And Regression Architecture

- `tests/integration/test_engine_contracts.py`
  Protects the `/api/search`, `/api/evolve`, and `/api/assemble` backend contract shapes.
- `tests/integration/test_pipeline_regression.py`
  Consolidates end-to-end backend regression checks for schema stability, concise chapter titles, and Malaysia-context preservation.
- `tests/unit/test_ga.py`
  Covers tournament bias, crossover validity, mutation uniqueness, elitism behavior, and convergence-on-plateau.
- `tests/unit/test_organize.py`
  Verifies cluster-aware organization and lower duplicate-source overlap than a naive baseline.
- `tests/integration/test_benchmark_queries.py`
  Runs the synthetic benchmark harness and checks suite-wide thresholds plus Malaysia-specific stability.
- `engine/benchmarks.py`
  Defines a broad, extensible library of benchmark cases and tag-based packs spanning technical, finance, science, policy, history, entertainment, logistics, legal, telecom, aviation, insurance, manufacturing, infrastructure, public-sector, and regional strategy topics.

Benchmark metrics tracked per case and aggregated per pack:

- average relevance
- focus coverage
- redundancy
- chapter distinctness
- average authority

Statistical summaries also include median, standard deviation, min/max, and interquartile spread so benchmark baselines are not based on a single narrow mean alone.

## Notes And Limitations

- Search quality depends on Wikipedia availability, DuckDuckGo availability, and outbound network access.
- Google and Bing HTML scraping are best-effort and may be blocked or return fewer results depending on network conditions or anti-bot protections.
- When search access is blocked or unavailable, the engine falls back to adaptive synthetic sources so the UI remains usable.
- The fallback layer is topic-agnostic, but it still performs best when at least some real source material is retrievable for the query.
- The semantic layer is fully local and offline, but it still depends on the quality of retrieved source text and the locally installed open-source Python stack.
- Chapter images come from Picsum and are decorative seed-based visuals, not topic-accurate illustrations.
- Browser history is stored locally in `localStorage`, not in a shared database.
- PDF export depends on the CDN-loaded `html2pdf` bundle referenced in `index.html`.

## Verification

The current codebase has been validated with:

```bash
npm run lint
npm run build
python -m unittest discover
python -m py_compile evolution_engine.py
```

## License

MIT
