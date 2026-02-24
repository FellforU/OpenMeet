# OpenMeet - AI Meeting Transcription Tool Design Document

> Date: 2026-02-24
> Status: Approved
> Target: Local-first, multi-model, multi-language AI meeting transcription desktop app

---

## 1. Product Overview

### 1.1 Vision

A local-first, privacy-focused AI meeting transcription tool with multi-model switching support. Benchmarked against Notion AI Notes and Feishu MeetingNotes.

### 1.2 Core Features (MVP)

- **Dual input**: File upload (mp3/wav/m4a/mp4) + Real-time microphone recording
- **Multi-engine ASR**: Whisper (English-best), Qwen3-ASR (dialect + noise-robust), Paraformer (Chinese-fastest)
- **Smart minutes generation**: Topic, conclusions, action items, discussion summary via local LLM (Ollama)
- **Speaker diarization**: Distinguish speakers (Speaker A/B), support rename
- **Timestamps + playback**: Click timestamp to seek audio, synchronized highlighting
- **State control**: Pause / Resume / Cancel with checkpoint recovery
- **Auto pipeline**: Transcription complete → auto diarization → ITN → punctuation → summary
- **Edit & export**: Edit transcript/summary inline, export Markdown / Word / PDF

### 1.3 Post-MVP Features

- Commercial API integration (OpenAI Whisper API, Alibaba Cloud ASR)
- Auto-degradation strategy (GPU insufficient → smaller model → cloud API)
- Cost tracking and quota management for cloud APIs
- Real-time system audio capture (WASAPI / CoreAudio)
- Keyword/hotword customization
- Meeting templates (standup / review / brainstorm)
- Multi-language real-time translation

### 1.4 Non-functional Requirements

- **Local-first**: All processing on user's machine by default, no data upload
- **Usability**: GUI-based, no command-line required
- **Cross-platform**: Windows + macOS
- **Performance**: 1-hour audio processed in 5-10 minutes on consumer GPU (6GB+ VRAM)

---

## 2. Technology Stack

| Layer | Technology | Rationale |
|-------|-----------|-----------|
| Desktop framework | **Tauri 2.x** | Small bundle (~10MB), high performance, proven by Vibe (5.3k stars) and Meetily (9.9k stars) |
| Frontend | **React 19 + TypeScript** | Rich ecosystem, reuse patterns from meeting project |
| UI library | **Ant Design 5** / shadcn/ui | Mature component library |
| State management | **Zustand** | Lightweight, TypeScript-friendly |
| Build tool | **Vite** | Fast HMR, Tauri integration |
| Backend core | **Rust (Tauri)** | File I/O, process management, SQLite, IPC routing |
| ASR service | **Python FastAPI** (Sidecar) | Unified support for all ASR engines |
| ASR engines | **faster-whisper** + **Qwen3-ASR** + **FunASR Paraformer** | Best coverage across languages |
| Speaker diarization | **CAMPPlus** (Chinese) + **pyannote-audio** (multilingual) | Language-adaptive |
| VAD | **FSMN-VAD** (Chinese) + **Silero-VAD** (general) | Language-adaptive |
| Punctuation | **CT-Transformer** (Chinese) | Best Chinese punctuation accuracy |
| ITN | **WeTextProcessing** | Chinese inverse text normalization |
| LLM summaries | **Ollama** | One-click deploy Qwen2.5/Mistral/Llama |
| Database | **SQLite** (via Tauri) | Local-first, zero config |
| Audio processing | **ffmpeg** (format conversion) + **cpal** (Rust audio capture) | Cross-platform audio |

---

## 3. Architecture

### 3.1 High-Level Architecture (Hybrid Mode)

```
┌──────────────────────────────────┐
│  Tauri Desktop App               │
│  ┌───────────┐  ┌─────────────┐ │
│  │ React UI  │  │ Rust Core   │ │
│  │           │  │ ├ IPC Router │ │
│  │ • Player  │  │ ├ File Mgmt │ │
│  │ • Editor  │  │ ├ Proc Mgmt │ │
│  │ • Export  │  │ └ SQLite DB  │ │
│  └───────────┘  └──────┬──────┘ │
└────────────────────────┼────────┘
                         │ manages
          ┌──────────────┼──────────────┐
          ▼              ▼              ▼
  ┌──────────────┐ ┌──────────┐ ┌────────────┐
  │ ASR Service  │ │ Ollama   │ │ Commercial │
  │ (FastAPI)    │ │          │ │ API Adapter│
  │              │ │ Qwen2.5  │ │            │
  │ Engine Pool: │ │ Mistral  │ │ OpenAI API │
  │ ├ Whisper    │ │ Llama    │ │ Alibaba    │
  │ ├ Qwen3-ASR │ └──────────┘ └────────────┘
  │ ├ Paraformer │
  │ └ Processors │
  └──────────────┘
```

### 3.2 Dual Input Data Flow

```
User Action              Tauri Rust Layer          Python ASR Service       Ollama
  │                           │                          │                    │
  ├─ Mode A: Upload file ───▶│                          │                    │
  │                           ├─ ffmpeg → WAV ─────────▶│                    │
  │                           │                          ├─ Create Job(FILE)  │
  │                           │                          ├─ VAD segmentation  │
  │                           │                          ├─ Segment-by-seg    │
  │  ◀── Real-time progress ──┤ ◀── SSE stream ─────────┤                    │
  │                           │                          │                    │
  ├─ Mode B: Start record ──▶│                          │                    │
  │                           ├─ Start cpal capture ───▶│                    │
  │                           │   Send PCM chunks/300ms  ├─ Create Job(STREAM)│
  │                           │                          ├─ Stream VAD+ASR    │
  │  ◀── Real-time text ──────┤ ◀── WS push results ────┤                    │
  │                           │                          │                    │
  ├─ Pause ──────────────────▶│ PUT /job/{id}/pause ───▶│ Cache state        │
  ├─ Resume ─────────────────▶│ PUT /job/{id}/resume ──▶│ Resume checkpoint  │
  ├─ Cancel ─────────────────▶│ PUT /job/{id}/cancel ──▶│ Cleanup            │
  │                           │                          │                    │
  │  (Transcription complete)  │                          │                    │
  │  ═══ Auto Post-Processing Pipeline ═══               │                    │
  │                           │                          │                    │
  │                           ├─ Step1: ITN ────────────▶│ (Whisper only)     │
  │                           ├─ Step2: Punctuation ────▶│ CT-Transformer     │
  │                           ├─ Step3: Diarization ───▶│ CAMPPlus/pyannote  │
  │                           ├─ Step4: Summary prompt ──┼───────────────────▶│
  │  ◀── Stream summary ──────┤ ◀──────────────────────────── Stream LLM ────┤
  │                           ├─ Step5: Save to SQLite   │                    │
  │  ◀── Status: READY ───────┤                          │                    │
```

### 3.3 Job State Machine

```
          ┌─────────┐
  Create ─▶│  IDLE   │
          └────┬────┘
        Start/ │
        Record │
          ┌────▼────┐
   ┌──────│ RUNNING │──────┐
   │      └────┬────┘      │
 Pause         │Done    Cancel
   │      ┌────▼──────┐    │
┌──▼───┐  │ COMPLETED │  ┌─▼────────┐
│PAUSED│  └────┬──────┘  │CANCELLED │
└──┬───┘       │auto     └──────────┘
Resume    ┌────▼──────┐
   │      │POST_PROC  │ ← ITN → Punct → Diarize → Summary
   └─────▶└────┬──────┘
               │
          ┌────▼──────┐
          │  READY    │ ← View / Edit / Export
          └───────────┘
```

---

## 4. ASR Engine Strategy

### 4.1 Three Engines

| Engine | Best For | Speed | VRAM | Notes |
|--------|----------|-------|------|-------|
| **faster-whisper** | English, multilingual | 4x Whisper | ~4GB (medium) | 99 languages, CTranslate2 optimized |
| **Qwen3-ASR** | Chinese dialects, noisy env | Moderate | ~3GB (0.6B), ~6GB (1.7B) | 22 dialects, best noise robustness |
| **Paraformer** (FunASR) | Standard Chinese | **Fastest** (~10x RT) | ~2GB | Non-autoregressive, lowest resource |

### 4.2 Auto-Recommendation

```python
def recommend_engine(language, hardware):
    if language in CHINESE_DIALECTS:
        return "qwen3"         # only Qwen3 supports dialects
    if language == "zh":
        if hardware.vram >= 6:
            return "qwen3"     # best Chinese quality
        else:
            return "paraformer" # fastest, lowest resource
    if language == "en":
        return "whisper"        # best English accuracy
    return "whisper"            # widest language coverage
```

### 4.3 Language-Adaptive Post-Processing

```python
def create_pipeline(language):
    if language in ("zh", *CHINESE_DIALECTS):
        return [
            FSMNVadProcessor(),        # Chinese-optimized VAD
            CTTransformerPunctuator(), # Best Chinese punctuation
            WeTextITNProcessor(),      # Chinese ITN
            CAMPPlusDiarizer(),        # Lightweight Chinese diarization
        ]
    else:
        return [
            SileroVadProcessor(),      # General-purpose VAD
            PyAnnoteDiarizer(),        # Best multilingual diarization
        ]
```

---

## 5. Backend: Python ASR Service

### 5.1 Directory Structure

```
asr_service/
├── main.py                    # FastAPI entry, uvicorn startup
├── config.py                  # Model paths, GPU config, degradation strategy
├── routers/
│   ├── jobs.py                # Job CRUD + state control (pause/resume/cancel)
│   ├── stream.py              # WebSocket real-time audio streaming
│   └── health.py              # GET /health
├── engines/
│   ├── base.py                # ASREngine Protocol + data models
│   ├── whisper_engine.py      # faster-whisper wrapper
│   ├── qwen3_engine.py        # Qwen3-ASR wrapper
│   ├── paraformer_engine.py   # FunASR Paraformer wrapper
│   └── openai_api_engine.py   # Commercial API adapter (Phase 4)
├── processors/
│   ├── factory.py             # Language-adaptive processor selection
│   ├── vad/
│   │   ├── fsmn_vad.py        # FSMN-VAD (Chinese-optimized)
│   │   └── silero_vad.py      # Silero-VAD (general)
│   ├── punctuation/
│   │   ├── ct_transformer.py  # CT-Transformer (Chinese)
│   │   └── noop.py            # No-op for engines with built-in punctuation
│   ├── diarization/
│   │   ├── campplus.py        # CAMPPlus (Chinese, lightweight)
│   │   └── pyannote.py        # pyannote-audio (multilingual)
│   ├── itn.py                 # WeTextProcessing ITN
│   └── timestamp_aligner.py   # Timestamp alignment (WhisperX approach)
├── pipeline.py                # Auto post-processing pipeline orchestrator
├── job_manager.py             # Job lifecycle + state machine
├── models/
│   ├── job.py                 # Job/Segment/Summary data models
│   └── manager.py             # Model download, cache, GPU management
└── utils/
    ├── gpu_monitor.py         # GPU VRAM monitoring, OOM prevention
    └── audio_utils.py         # Audio format utilities
```

### 5.2 API Endpoints

```
POST   /jobs                    → Create transcription job
GET    /jobs/{id}               → Get job status + progress
POST   /jobs/{id}/start         → Start transcription (file mode)
PUT    /jobs/{id}/pause         → Pause transcription
PUT    /jobs/{id}/resume        → Resume from checkpoint
PUT    /jobs/{id}/cancel        → Cancel and cleanup
WS     /ws/jobs/{id}/stream     → Real-time audio streaming (stream mode)
GET    /jobs/{id}/result        → Get transcription result
GET    /health                  → Service health check
GET    /engines                 → List available engines and models
POST   /engines/{name}/download → Download a model
```

### 5.3 ASR Engine Protocol

```python
class ASREngine(Protocol):
    async def transcribe(self, audio: AudioInput) -> TranscriptionResult: ...
    async def transcribe_stream(self, audio_chunks: AsyncIterator[bytes]) -> AsyncIterator[Segment]: ...
    async def get_capabilities(self) -> EngineCapabilities: ...
    async def load_model(self, model_size: str) -> None: ...
    async def unload_model(self) -> None: ...
```

### 5.4 Post-Processing Pipeline

```python
class PostProcessingPipeline:
    async def run(self, job: TranscriptionJob) -> None:
        job.status = JobStatus.POST_PROCESSING

        processors = ProcessorFactory.create(job.language)

        # Step 1: ITN (skip if engine has built-in ITN, e.g. Qwen3-ASR)
        if job.engine != "qwen3":
            segments = await self.itn.normalize(job.segments, job.language)

        # Step 2: Punctuation restoration (skip if engine handles it)
        if job.engine not in ("qwen3",):
            segments = await processors.punctuator.restore(segments)

        # Step 3: Speaker diarization
        segments = await processors.diarizer.process(job.audio_path, segments)

        # Step 4: Generate meeting summary via Ollama
        summary = await self.summarizer.generate(segments, template=MEETING_SUMMARY_TEMPLATE)

        # Step 5: Persist
        await self.storage.save(job.id, segments, summary)
        job.status = JobStatus.READY
```

---

## 6. Backend: Tauri Rust Layer

### 6.1 Directory Structure

```
src-tauri/src/
├── main.rs                    # Tauri entry point
├── commands/
│   ├── audio.rs               # Audio file processing (ffmpeg invocation)
│   ├── transcription.rs       # Transcription flow orchestration
│   ├── project.rs             # Project CRUD (SQLite)
│   └── export.rs              # Export Markdown / Word / PDF
├── services/
│   ├── sidecar_manager.rs     # Python process lifecycle management
│   ├── ollama_client.rs       # Ollama HTTP client
│   └── model_registry.rs      # Installed models registry
├── db/
│   └── schema.rs              # SQLite table definitions
└── utils/
    ├── hardware_detect.rs     # GPU detection, model size recommendation
    └── audio_capture.rs       # cpal microphone capture
```

### 6.2 Database Schema (SQLite)

```sql
CREATE TABLE projects (
    id          TEXT PRIMARY KEY,
    title       TEXT NOT NULL,
    audio_path  TEXT NOT NULL,
    duration_ms INTEGER,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE transcriptions (
    id          TEXT PRIMARY KEY,
    project_id  TEXT REFERENCES projects(id),
    engine      TEXT NOT NULL,
    model_size  TEXT NOT NULL,
    language    TEXT,
    segments    JSON NOT NULL,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE summaries (
    id              TEXT PRIMARY KEY,
    project_id      TEXT REFERENCES projects(id),
    llm_model       TEXT NOT NULL,
    topic           TEXT,
    conclusions     JSON,
    action_items    JSON,
    discussion      JSON,
    raw_markdown    TEXT,
    edited_markdown TEXT,
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
```

---

## 7. Frontend: React Component Architecture

### 7.1 Page Layout

```
┌──────────────────────────────────────────────────────────┐
│  TitleBar                                       ─ □ ✕   │
├────────┬─────────────────────────────────────────────────┤
│        │  HeaderBar                                      │
│        │  [Project Title]  [Engine: Whisper ▾]  [⚙️]     │
│ Side   ├─────────────────────────────────────────────────┤
│ bar    │  WorkspacePanel (resizable split)                │
│        │  ┌──────────────────┬──────────────────────┐   │
│ [P1]   │  │ TranscriptPanel  │   SummaryPanel        │   │
│ [P2]   │  │  Segments with   │   Topic / Conclusions │   │
│ [P3]   │  │  timestamps &    │   Action Items /      │   │
│ [+]    │  │  speaker badges  │   Discussion Summary  │   │
│        │  └──────────────────┴──────────────────────┘   │
│        ├─────────────────────────────────────────────────┤
│        │  ControlBar                                     │
│        │  [⏪ ▶️ ⏩] [━━●━━━ 01:23/45:00] [🔊]           │
│        │  [📎Upload] [🎙️Record] [⏸Pause] [⏹Stop] [📤Export]│
│        ├─────────────────────────────────────────────────┤
│        │  StatusBar [Progress] [Pipeline Steps] [GPU]    │
└────────┴─────────────────────────────────────────────────┘
```

### 7.2 Component Tree

```
App
├── TitleBar
├── Sidebar
│   ├── ProjectList
│   │   └── ProjectItem
│   └── NewProjectButton
├── MainLayout
│   ├── HeaderBar
│   │   ├── ProjectTitle (editable)
│   │   ├── EngineSelector
│   │   │   ├── ModelSizeSelector
│   │   │   └── LanguageSelector
│   │   └── SettingsButton
│   ├── WorkspacePanel (resizable)
│   │   ├── TranscriptPanel
│   │   │   ├── TranscriptToolbar
│   │   │   ├── SegmentList (virtualized)
│   │   │   │   └── SegmentItem
│   │   │   │       ├── Timestamp (clickable → seek audio)
│   │   │   │       ├── SpeakerBadge (clickable → rename)
│   │   │   │       └── TextContent (editable)
│   │   │   └── EmptyState
│   │   └── SummaryPanel
│   │       ├── SummaryToolbar
│   │       ├── TopicSection
│   │       ├── ConclusionsSection
│   │       ├── ActionItemsSection
│   │       ├── DiscussionSection
│   │       └── SummaryEditor (Markdown)
│   ├── ControlBar
│   │   ├── AudioPlayer
│   │   │   ├── PlaybackControls
│   │   │   ├── ProgressBar
│   │   │   ├── SpeedSelector
│   │   │   └── VolumeControl
│   │   └── ActionButtons
│   │       ├── UploadButton
│   │       ├── RecordButton
│   │       └── ExportButton
│   └── StatusBar
│       ├── JobProgress
│       ├── PipelineSteps
│       ├── EngineStatus
│       └── GPUUsage
└── SettingsDialog
    ├── GeneralTab
    ├── EngineTab
    ├── OllamaTab
    ├── APITab (Phase 4)
    └── ExportTab
```

### 7.3 Core State (Zustand)

```typescript
interface TranscriptionStore {
  job: {
    id: string | null
    mode: 'file' | 'stream'
    status: 'idle' | 'running' | 'paused' | 'cancelled'
           | 'completed' | 'post_processing' | 'ready'
    progress: number
    pipelineStep: 'transcribing' | 'diarizing' | 'summarizing' | null
  }
  segments: Segment[]
  summary: Summary | null
  audio: {
    source: 'file' | 'microphone' | null
    filePath: string | null
    duration: number
    currentTime: number
    isPlaying: boolean
    playbackSpeed: number
  }

  // Actions
  uploadFile: (file: File) => Promise<void>
  startRecording: () => Promise<void>
  pauseJob: () => Promise<void>
  resumeJob: () => Promise<void>
  cancelJob: () => Promise<void>
  seekTo: (time: number) => void
  updateSegmentText: (id: string, text: string) => void
  renameSpeaker: (oldName: string, newName: string) => void
  regenerateSummary: () => Promise<void>
  exportAs: (format: 'markdown' | 'word' | 'pdf') => Promise<void>
}
```

---

## 8. Development Phases

### Phase 1: Basic Transcription Tool (Week 1-2)

**Goal:** Runnable desktop app, upload audio → Whisper transcribe → display text

```
Week 1: Skeleton
T1.1  Initialize Tauri + React + TypeScript project
T1.2  Set up Python ASR Service skeleton (FastAPI + uvicorn)
T1.3  Implement Tauri Sidecar management (start/stop Python process)
T1.4  Integrate faster-whisper engine (whisper_engine.py)
T1.5  Implement audio preprocessing (ffmpeg format conversion, resample to 16kHz)
T1.6  Implement POST /jobs + /jobs/{id}/start basic transcription API
T1.7  Tauri Rust: audio file picker + IPC calls to ASR Service

Week 2: Basic UI
T2.1  Implement Sidebar + ProjectList (SQLite CRUD)
T2.2  Implement UploadButton + file picker dialog
T2.3  Implement TranscriptPanel + SegmentList (basic text display)
T2.4  Implement JobProgress bar (SSE progress receiving)
T2.5  Implement AudioPlayer (basic play/pause/progress bar)
T2.6  Timestamp click-to-seek
T2.7  E2E test: upload WAV → Whisper transcribe → display text → play audio
```

**Deliverable:** Upload audio, Whisper transcribe, display timestamped text, click-to-seek playback

### Phase 2: Multi-Model + Real-time Recording + Diarization (Week 3-4)

**Goal:** Integrate Qwen3-ASR + Paraformer, real-time recording, speaker diarization

```
Week 3: Multi-Engine + Recording
T3.1  Integrate Qwen3-ASR engine (qwen3_engine.py)
T3.2  Implement EngineSelector + ModelSizeSelector components
T3.3  Implement Rust audio capture (cpal crate, microphone input)
T3.4  Implement WebSocket streaming transcription (WS /ws/jobs/{id}/stream)
T3.5  Implement RecordButton + recording interaction (start/pause/stop)
T3.6  Implement Job state machine (pause/resume/cancel API + frontend sync)
T3.7  Real-time text streaming display (auto-append + auto-scroll)
T3.8  Integrate FunASR Paraformer engine (paraformer_engine.py)

Week 4: Diarization + Edit + Post-Processing
T4.1   Implement dual diarization: CAMPPlus (Chinese) + pyannote (multilingual)
T4.2   Implement SpeakerBadge component (color-coded, click to rename)
T4.3   Implement transcript text editing (double-click edit, blur to save)
T4.4   Implement LanguageSelector (zh/en/ja/ko/auto-detect)
T4.5   GPU VRAM management: model load/unload/auto-degradation
T4.6   Model download manager UI (progress, installed model list)
T4.7   Integration test: Chinese audio → Qwen3-ASR → diarization → edit
T4.8   Integrate WeTextProcessing / FunASR ITN module
T4.9   Whisper Chinese ITN unit tests (numbers/dates/currency/phone)
T4.10  Implement ProcessorFactory (language-adaptive processor selection)
T4.11  Integrate FSMN-VAD + CT-Transformer (migrate models from meeting project)
```

**Deliverable:** Switch Whisper/Qwen3/Paraformer, real-time recording with pause/resume/cancel, speaker diarization, editable text, language-adaptive post-processing (ITN + punctuation + VAD)

### Phase 3: Smart Minutes + Auto Pipeline (Week 5-6)

**Goal:** Auto-generate structured minutes after transcription, support export

```
Week 5: Minutes Generation
T5.1  Ollama integration (detect/start/model management)
T5.2  Design minutes prompt templates (Chinese/English bilingual)
T5.3  Implement PostProcessingPipeline (auto-trigger on transcription complete)
T5.4  Implement SummaryPanel (stream Ollama output)
T5.5  Implement PipelineSteps status indicator
T5.6  Summary Markdown editor (SummaryEditor)
T5.7  Summary "Regenerate" function (switch LLM model / adjust prompt)

Week 6: Export + Polish
T6.1  Export Markdown format (transcript + summary merged)
T6.2  Export Word format (python-docx)
T6.3  Export PDF format (weasyprint or docx-to-pdf)
T6.4  ExportButton + format dropdown menu
T6.5  SettingsDialog (GeneralTab + EngineTab + OllamaTab)
T6.6  Chinese punctuation restoration post-processing
T6.7  E2E test: record → Qwen3 transcribe → diarization → auto summary → export Word
```

**Deliverable:** Full transcription → diarization → summary auto-pipeline, Markdown/Word/PDF export, settings panel

### Phase 4: Commercial API + Productization (Week 7-8)

**Goal:** Commercial API integration, product polish, packaging for release

```
Week 7: Commercial API + Advanced Features
T7.1  Implement OpenAI Whisper API adapter (openai_api_engine.py)
T7.2  Implement Alibaba Cloud ASR API adapter
T7.3  APITab settings (key management, usage stats, cost alerts)
T7.4  Auto-degradation: GPU insufficient → smaller model → cloud API
T7.5  Mode indicator (Local 🟢 / Cloud ☁️ + estimated cost)
T7.6  System audio capture (Windows WASAPI / macOS CoreAudio)
T7.7  Search: full-text search transcripts + highlight

Week 8: Packaging & Release
T8.1  Tauri app signing (Windows code signing + macOS notarization)
T8.2  Auto-update mechanism (Tauri updater)
T8.3  App icon + splash screen design
T8.4  First-run guide (model download wizard)
T8.5  Performance: virtualized long lists + large file handling
T8.6  Error handling & user feedback (global error boundary + toast)
T8.7  Build Windows/macOS installers + GitHub Release
```

**Deliverable:** Commercial API fallback, auto-degradation, signed app packages, distributable installers

### Phase 5: Advanced Features (Post-MVP)

```
T-post.1  System audio + microphone dual-channel mixed recording
T-post.2  Keyword/hotword customization (domain-specific term optimization)
T-post.3  Multi-language real-time translation (transcribe + translate)
T-post.4  Meeting templates (standup/review/brainstorm with different prompts)
T-post.5  Team collaboration: export to Notion/Feishu/Yuque
T-post.6  Voice sentiment analysis (positive/negative/neutral tagging)
T-post.7  macOS/Windows system tray persistent recording
```

---

## 9. Key Interactions

| Interaction | Behavior |
|-------------|----------|
| Click timestamp | Audio player seeks to position and starts playback |
| Click speaker badge | Popup rename input, batch replace all instances |
| Double-click transcript text | Enter edit mode, blur to auto-save |
| Drag splitter | Resize left/right panel ratio |
| During transcription | New segments auto-scroll to bottom, existing don't jump |
| Auto post-processing | StatusBar shows step progress: Transcribe ✅ → Diarize ⏳ → Summary ⏳ |
| Recording pause | Record button pulse animation stops, shows elapsed time |
| Transcription complete | Auto-trigger: ITN → Punctuation → Diarization → Summary |

---

## 10. Technical Risks & Mitigation

| Risk | Impact | Mitigation |
|------|--------|-----------|
| Qwen3-ASR flash-attn compilation issues | Blocks Phase 2 | Provide fallback without flash-attn, use sdpa attention |
| pyannote requires HuggingFace Token | Poor UX | First-run config guide, cache models locally; prefer CAMPPlus for Chinese |
| GPU VRAM OOM (multiple models loaded) | App crash | Single-model-at-a-time loading + gpu_monitor + auto-unload idle models |
| Python Sidecar slow startup (~3-5s) | First-open lag | Splash screen + lazy model loading (load on first use) |
| Tauri system audio capture cross-platform | Phase 4 delay | MVP: microphone only, system audio capture in Post-MVP |
| Long audio (2h+) memory overflow | Processing failure | Chunked processing + streaming result writes + memory cap |
| Ollama not installed / model not downloaded | Summary unavailable | Detect Ollama status + one-click install guide + degrade to no-summary mode |
| FunASR large dependency tree | Install complexity | Isolate in optional extra: `pip install openmeet[funasr]` |

---

## 11. Reference Projects

| Project | Stars | What to Learn |
|---------|-------|---------------|
| [Meetily](https://github.com/Zackriya-Solutions/meeting-minutes) | ~9.9k | Tauri architecture, Ollama integration, diarization UX |
| [Vibe](https://github.com/thewh1teagle/vibe) | ~5.3k | Tauri + whisper.cpp integration, export formats, GPU acceleration |
| [Buzz](https://github.com/chidiwilliams/buzz) | ~17.8k | Multi-engine switching design, real-time recording |
| [WhisperX](https://github.com/m-bain/whisperX) | ~20.2k | Word-level timestamps, pyannote diarization integration |
| [faster-whisper](https://github.com/SYSTRAN/faster-whisper) | ~21k | CTranslate2 optimized inference |
| [Qwen3-ASR](https://github.com/QwenLM/Qwen3-ASR) | Official | Dialect support, noise robustness |
| [meeting (cloned)](./meeting/) | - | FunASR integration, React hooks pattern, WebSocket real-time |
| [Scriberr](https://github.com/rishikanthc/Scriberr) | ~1.4k | Go+Svelte self-hosted architecture, REST API design |

---

## 12. Meeting Project Reuse Assessment

### Reusable

- React frontend Hook patterns (8 custom hooks)
- WebSocket real-time communication approach
- Speaker diarization UI/UX design
- Export functionality (TXT/JSON/DOCX)
- FunASR model files (Paraformer, FSMN-VAD, CT-Transformer, CAMPPlus)

### Not Reusable

- Backend locked to FunASR only (no adapter pattern)
- Pure web app architecture (not desktop)
- Hardcoded paths, zero test coverage
- No plugin/adapter architecture
