# OpenMeet Project Rules

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

- **Product:** Local-first AI meeting transcription tool
- **Design Doc:** `docs/plans/2026-02-24-openmeet-design.md`
- **Implementation Plan:** `docs/plans/2026-02-24-openmeet-implementation.md`

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Desktop | Tauri 2.x (Rust) |
| Frontend | React 19 + TypeScript + Vite + Ant Design + Zustand |
| ASR Service | Python 3.12 + FastAPI (Sidecar) |
| ASR Engines | faster-whisper, Qwen3-ASR, FunASR Paraformer |
| LLM | Ollama (Qwen2.5 / Mistral) |
| Database | SQLite |

## Architecture

```
Tauri (Rust) ─── IPC ───▶ React Frontend
      │
      └── manages ──▶ Python ASR Service (FastAPI, port 18090)
      └── manages ──▶ Ollama (LLM summaries)
```

## Development Commands

```bash
# Python ASR Service
source .venv/bin/activate
python -m asr_service.main                    # Start ASR service
python -m pytest tests/ -v                    # Run tests
python -m pytest tests/ --cov=asr_service     # Run tests with coverage

# Tauri + React Frontend
npm run tauri dev                             # Start dev mode
npm run tauri build                           # Production build

# Ollama (Phase 3+)
ollama serve                                  # Start Ollama
ollama pull qwen2.5:7b                        # Download model
```

## File Organization

- `asr_service/` — Python ASR backend (FastAPI)
- `src/` — React frontend
- `src-tauri/` — Rust Tauri backend
- `tests/` — Python tests
- `docs/plans/` — Design and implementation plans
- `models/` — Downloaded ASR model files (gitignored)
