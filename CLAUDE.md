# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Language Rules (Override Global)

This project uses Chinese for all human-facing content:

- **Chinese:** Command-line responses, user interactions, documentation files, commit body descriptions, PR descriptions, UI text, comments explaining business logic
- **English:** Variable names, function names, class names, code comments (technical), git commit type prefix (feat/fix/etc), API endpoints, config files

Example commit message:
```
feat(asr): integrate faster-whisper engine

集成faster-whisper引擎，支持base/small/medium/large模型切换
```

## Project Context

**Product:** Local-first AI meeting transcription desktop app with knowledge base and RAG chat.

- **Design Doc:** `docs/plans/2026-02-24-openmeet-design.md`
- **Implementation Plan:** `docs/plans/2026-02-24-openmeet-implementation.md`

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Desktop | Tauri 2.x (Rust) |
| Frontend | React 19 + TypeScript + Vite + Tailwind CSS 4 + Radix UI + Zustand |
| ASR Service | Python 3.12 + FastAPI (Sidecar on port 18090) |
| ASR Engines | faster-whisper, Qwen3-ASR, FunASR Paraformer, OpenAI Whisper API, Alibaba ASR |
| LLM | Multi-provider (Ollama, DeepSeek, Qwen, OpenAI, Gemini, etc.) via OpenAI-compatible API |
| Knowledge | sentence-transformers + LanceDB + RAG pipeline |
| Database | SQLite (Rust rusqlite for app data, Python LanceDB for vectors) |
| i18n | i18next (zh/en, namespaces: common, workspace, settings, guide) |

## Architecture

```
┌─────────────────────────────────────────────────────┐
│ React Frontend (Vite dev server :1420)               │
│  ├─ Zustand stores (settings, project, recording,   │
│  │   transcription, engine, chat)                    │
│  ├─ Tauri IPC → Rust commands (DB, audio, sidecar)  │
│  └─ HTTP/WS → Python ASR service (:18090)           │
├─────────────────────────────────────────────────────┤
│ Tauri Rust Backend (src-tauri/)                      │
│  ├─ database.rs — SQLite CRUD (projects, segments,  │
│  │   summaries, attachments, notes, settings KV)     │
│  ├─ sidecar.rs — spawn/manage Python ASR process    │
│  ├─ audio_capture.rs — mic/system audio recording   │
│  ├─ capture/ — platform audio (cpal, PipeWire, etc) │
│  └─ crypto.rs — RSA-OAEP encrypt/decrypt API keys   │
├─────────────────────────────────────────────────────┤
│ Python ASR Service (asr_service/)                    │
│  ├─ engines/ — ASR engine implementations            │
│  │   (whisper, qwen3, paraformer, openai, alibaba)   │
│  ├─ processors/ — VAD, diarization, punctuation, ITN │
│  ├─ routers/ — FastAPI routes (jobs, engines, stream, │
│  │   health, config, search, index, mcp, chat)       │
│  ├─ knowledge/ — RAG pipeline (embedder, vector      │
│  │   store, chunker, reranker, MCP tools)            │
│  ├─ services/ — Ollama client, post-processing,      │
│  │   summary templates, degradation                  │
│  └─ job_manager.py — transcription job lifecycle     │
└─────────────────────────────────────────────────────┘
```

### Key Data Flow

1. **Recording:** Rust `audio_capture` captures mic/system audio → WAV files → frontend sends to ASR service
2. **Transcription:** `JobManager` orchestrates: preprocess audio → engine.transcribe() → post-processing (VAD, diarization, ITN, punctuation) → segments
3. **Real-time streaming:** WebSocket at `/stream/ws/{job_id}` sends audio chunks, receives segments in real-time
4. **Knowledge/RAG:** Documents indexed via embedder → LanceDB vectors → MCP tools for retrieval → RAG pipeline for chat
5. **Settings:** Persisted in SQLite via Tauri IPC `db_get_setting`/`db_set_setting` as JSON, API keys encrypted with RSA-OAEP

### Cross-boundary Conventions

- **Rust ↔ TypeScript:** Rust uses `snake_case`, TypeScript uses `camelCase`. `projectStore.ts` has `mapToRust()`/`mapFromRust()` helpers.
- **Frontend ↔ ASR Service:** Frontend uses `tauriFetch()` (HTTP proxy through Rust) to bypass CORS, not direct `fetch()`.
- **ASR Engine Protocol:** All engines implement `ASREngine` protocol in `engines/base.py` (transcribe, load_model, unload_model, etc.)
- **Router dependency injection:** Routers use module-level `set_manager()`/`get_manager()` pattern instead of FastAPI Depends.

## Development Commands

```bash
# Python ASR Service
source .venv/bin/activate
python -m asr_service.main                    # Start ASR service (port 18090)
python -m pytest tests/ -v                    # Run all tests
python -m pytest tests/asr_service/test_jobs.py -v              # Run single test file
python -m pytest tests/asr_service/test_jobs.py::test_name -v   # Run single test
python -m pytest tests/ --cov=asr_service     # Run tests with coverage

# Tauri + React Frontend
npm run dev                                   # Vite dev server only (no Tauri)
npm run tauri dev                             # Full Tauri dev mode (Rust + Vite)
npm run build                                 # TypeScript check + Vite build
npm run tauri build                           # Production build

# Rust
cd src-tauri && cargo build                   # Build Rust backend
cd src-tauri && cargo check                   # Type check only
```

### Test Configuration

- Python tests use `pytest-asyncio` with `asyncio_mode = auto` (pytest.ini)
- Test client fixture in `tests/asr_service/conftest.py` uses `httpx.AsyncClient` with `ASGITransport`
- Each test gets a fresh `JobManager` instance

## File Organization

- `asr_service/` — Python ASR backend (FastAPI)
- `src/` — React frontend
  - `stores/` — Zustand state (settingsStore, projectStore, recordingStore, transcriptionStore, engineStore, chatStore)
  - `services/` — API clients (asrClient, llmClient, knowledgeClient, chatClient, httpProxy, audioLoader)
  - `components/` — UI organized by feature area (Sidebar, HeaderBar, ControlBar, Workspace, Settings, Chat, Editor, Guide, StatusBar)
  - `components/ui/` — Radix-based primitives (shadcn/ui style)
  - `i18n/locales/{zh,en}/` — Translation JSON files (common, workspace, settings, guide)
  - `types/index.ts` — Shared TypeScript types (Project, Segment, Summary, JobStatus, PipelineStep)
- `src-tauri/` — Rust Tauri backend
  - `src/capture/` — Platform-specific audio capture (mic, system_linux, system_macos, system_windows)
- `tests/` — Python tests (mirrors asr_service structure)
- `models/` — Downloaded ASR model files (gitignored)
- `docs/plans/` — Design and implementation plans
