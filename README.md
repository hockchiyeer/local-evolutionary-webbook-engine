# Multi-Source Evolutionary WebBook Engine

This repository generates a structured "WebBook" from a topic prompt without using paid commercial LLMs or commercial API dependencies.

You can explore the live application built from this repository's source code at: [https://ai.studio/apps/7481953a-4b23-442b-ad65-93d3b601ffc0?fullscreenApplet=true](https://ai.studio/apps/7481953a-4b23-442b-ad65-93d3b601ffc0?fullscreenApplet=true)

The stack combines:

- a React + Vite frontend
- an Express bridge server
- a local Python evolutionary engine
- public and free content sources
- local NLP, ranking, and chapter-assembly logic

The result is a multi-chapter reading experience built from live source intake, local source evolution, and local assembly.

## What It Does

- searches across multiple public and free sources
- normalizes and deduplicates the source frontier
- ranks sources with local relevance, authority, depth, and redundancy signals
- evolves a tighter candidate set with a local genetic algorithm
- assembles a 10-chapter WebBook with definitions, subtopics, and source citations
- exposes the real pipeline stages and source telemetry in the portal UI
- stores generated books in browser history
- persists feedback-driven reward learning in a shared SQLite store
- exports to PDF, Print / Save as PDF, native Word `.docx`, HTML, and TXT

## Free/Public Source Mix

The engine can ingest from:

- `Wikipedia`
- `Open Library`
- `Crossref`
- `DuckDuckGo`
- `Google`
- `Bing`
- user-supplied manual URLs
- adaptive local fallback synthesis when live retrieval is insufficient

Notes:

- `Open Library` is used for book, author, and subject metadata.
- `Crossref` is used for scholarly metadata and abstracts when available.
- `Google` and `Bing` are best-effort HTML retrieval paths and may return fewer results depending on network conditions.
- `Crossref` can optionally receive a polite contact email through `WEBBOOK_CONTACT_EMAIL`.

## Current Quality Strategy

The repo now aims to reduce "mechanical template-like" output by widening the source frontier and improving evidence quality before assembly:

- direct page-excerpt enrichment is applied to shallow public-web hits
- repeated SERP phrasing is cleaned before ranking
- `Open Library` adds book-oriented context
- `Crossref` adds research-oriented context
- a supplemental live-search fallback can blend additional Google and DuckDuckGo evidence when the frontier is still thin after the primary provider passes
- result caps and time budgets are increased so the engine can work with a broader frontier
- the UI now maps real engine stages and source-provider progress instead of showing decorative progress only

## Pipeline

The core runtime flow is:

1. `Source discovery`
   Pulls from enabled providers, manual URLs, and free metadata sources.
2. `Frontier cleanup`
   Normalizes, deduplicates, semantically filters, and enriches weak hits.
3. `Evolutionary selection`
   Applies local feature scoring, redundancy penalties, crossover, mutation, and ranked source selection.
4. `Book assembly`
   Builds chapter clusters, semantic title paths, sentence-level micro-GA selection, and final chapter structure.

## Adaptive Feedback Persistence

User feedback on whole books, chapter quality, and custom tags is now persisted in a backend SQLite store at `data/feedback-learning.sqlite`.

- the server automatically migrates the older JSON learning store on startup when present
- stored feedback is shared across sessions and machines that use the same backend instance
- the persisted reward profile is fed back into later `evolve` and `assemble` runs to strengthen the local learning loop
- `npm run clean` preserves the persisted learning store files under `data/`

## UI Mapping

The portal UI now exposes the real runtime model:

- per-source intake tiles with live status, batch result counts, and elapsed time
- a stage atlas for `Source Discovery`, `Evolutionary Selection`, and `NLP Book Assembly`
- live frontier, evolved-population, and chapter counts
- an artifacts drawer showing:
  - search frontier items
  - ranked/evolved source candidates
  - chapter blueprint output

## Architecture

### Frontend

- React 19
- TypeScript
- Vite 6
- Tailwind CSS 4
- Motion
- Lucide React

### Server

- Node.js
- Express 4
- CORS
- `tsx` for development
- `feedbackStore.ts` for shared SQLite-backed learning persistence
- `server/searchFallback.ts` for query-variant supplemental Google and DuckDuckGo evidence recovery
- `server/pdfBridge.ts` for local Puppeteer-based high-resolution PDF generation

### Python Engine

- `evolution_engine.py` for CLI-style orchestration
- `engine/search.py` for provider retrieval, enrichment, ranking, and fallback gating
- `engine/ga.py` for source-set evolution
- `engine/fitness.py` for source-set fitness scoring
- `engine/nlp.py` and related modules for local semantic analysis
- `engine/organize.py` and `engine/titles.py` for chapter shaping and title generation

## Repository Structure

```text
.
|-- data/
|   `-- .gitignore
|-- engine/
|   |-- __init__.py
|   |-- archetypes.py
|   |-- benchmarks.py
|   |-- contracts.py
|   |-- fallback.py
|   |-- features.py
|   |-- fitness.py
|   |-- ga.py
|   |-- nlp.py
|   |-- nlp_graph.py
|   |-- normalize.py
|   |-- organize.py
|   |-- query_profiles.py
|   |-- reinforcement.py
|   |-- search.py
|   `-- titles.py
|-- scripts/
|   |-- clean.mjs
|   |-- clean-safe.mjs
|   `-- clean-test.mjs
|-- server/
|   |-- pdfBridge.ts
|   `-- searchFallback.ts
|-- src/
|   |-- components/
|   |   |-- AppHeader.tsx
|   |   |-- ControlSidebar.tsx
|   |   |-- HistoryDrawer.tsx
|   |   |-- WebBookErrorBoundary.tsx
|   |   `-- WebBookViewer.tsx
|   |-- hooks/
|   |   `-- useWebBookEngine.ts
|   |-- services/
|   |   |-- docxExport.ts
|   |   |-- evolutionService.ts
|   |   |-- searchFallbackService.ts
|   |   `-- exportService.ts
|   |-- utils/
|   |   `-- webBookRender.ts
|   |-- App.tsx
|   |-- index.css
|   |-- main.tsx
|   `-- types.ts
|-- tests/
|   |-- __init__.py
|   |-- integration/
|   |   |-- __init__.py
|   |   |-- test_benchmark_queries.py
|   |   |-- test_engine_contracts.py
|   |   |-- test_fallback.py
|   |   |-- test_pipeline_regression.py
|   |   `-- test_query_focus.py
|   |-- smoke/
|   |   |-- __init__.py
|   |   |-- test_malaysia_search.py
|   |   |-- test_python.py
|   |   `-- test_wikipedia.py
|   `-- unit/
|       |-- __init__.py
|       |-- test_features.py
|       |-- test_fitness.py
|       |-- test_ga.py
|       |-- test_nlp.py
|       |-- test_organize.py
|       |-- test_search_normalize.py
|       `-- test_webbook_titles.py
|-- .env.example
|-- .gitignore
|-- CHANGELOG.md
|-- LICENSE.txt
|-- README.md
|-- evolution_engine.py
|-- feedbackStore.ts
|-- index.html
|-- metadata.json
|-- package-lock.json
|-- package.json
|-- requirements.txt
|-- server.ts
|-- tsconfig.json
`-- vite.config.ts
```

Generated output directories such as `build/` and `dist/` are intentionally omitted from the tree above.

## Setup

### Prerequisites

- Node.js
- npm
- Python 3 available as `python`

### Install

```bash
npm install
python -m pip install -r requirements.txt
```

## Environment

`.env.example` includes:

```env
APP_URL="MY_APP_URL"
WEBBOOK_CONTACT_EMAIL=""
```

`WEBBOOK_CONTACT_EMAIL` is optional. If set, it is passed through to Crossref requests as a polite contact signal.

## Development

Start the local app:

```bash
npm run dev
```

Default dev URL:

```text
http://localhost:3000
```

Useful commands:

```bash
npm run build
npm run clean
npm run lint
npm run test:clean
python -m unittest discover
```

## Runtime Budgets

The frontend and backend now allow longer runs so larger source frontiers can be assembled:

- `search`: up to 420 seconds
- `evolve`: up to 480 seconds
- `assemble`: up to 480 seconds

The Express server also accepts larger JSON payloads than before to support richer search and evolution artifacts.

## Testing And Verification

The repo is currently validated with commands such as:

```bash
npm run build
python -B -m unittest tests.unit.test_search_normalize tests.integration.test_fallback tests.integration.test_engine_contracts
```

## Notes And Limitations

- `Google` and `Bing` retrieval remain best-effort and may be rate-limited or blocked.
- `Crossref` and `Open Library` improve topic quality, but they are metadata-oriented sources and do not replace full-text access.
- manual URLs are capped to keep the frontier controllable
- fallback synthesis still exists for resilience, but the engine now tries harder to build from real public evidence first
- export behavior depends partly on browser behavior, especially for Print / Save as PDF

## No Paid AI Dependency

This repo does not require:

- commercial LLM APIs
- hosted embedding APIs
- paid search APIs
- paid model providers

The generation strategy is local, evolutionary, retrieval-driven, and based on public/free data sources.
