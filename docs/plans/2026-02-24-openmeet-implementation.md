# OpenMeet Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a local-first, multi-model AI meeting transcription desktop app with Tauri + React + Python ASR Sidecar.

**Architecture:** Tauri desktop shell (Rust) manages a Python FastAPI sidecar for ASR processing. Three engines (faster-whisper, Qwen3-ASR, Paraformer) behind a unified adapter interface. Ollama for LLM summary generation. Language-adaptive post-processing pipeline (VAD, ITN, punctuation, diarization).

**Tech Stack:** Tauri 2.x, React 19, TypeScript, Vite, Zustand, Ant Design, Python 3.12, FastAPI, faster-whisper, qwen-asr, FunASR, pyannote-audio, Ollama, SQLite

**Reference Design:** `docs/plans/2026-02-24-openmeet-design.md`

---

## Phase 1: Basic Transcription Tool (Week 1-2)

**Phase Goal:** A runnable Tauri desktop app that can upload audio, transcribe with Whisper, display timestamped text, and play audio with click-to-seek.

---

### Task 1: Initialize Tauri + React + TypeScript Project

**Files:**
- Create: `package.json`, `tsconfig.json`, `vite.config.ts`
- Create: `src/main.tsx`, `src/App.tsx`, `src/App.css`
- Create: `src-tauri/Cargo.toml`, `src-tauri/src/main.rs`, `src-tauri/tauri.conf.json`
- Create: `src-tauri/capabilities/default.json`

**Step 1: Scaffold Tauri + React project**

Run:
```bash
cd /home/yuchen_wu_trusone_com/projects/openMeet
npm create tauri-app@latest app -- --template react-ts --manager npm
```

Expected: A `app/` directory with Tauri + React + TypeScript skeleton.

**Step 2: Move app contents to project root**

```bash
# Move everything from app/ to project root
cp -r app/* app/.* . 2>/dev/null || true
rm -rf app/
```

**Step 3: Install core frontend dependencies**

```bash
npm install
npm install zustand antd @ant-design/icons axios
npm install -D @types/node
```

Expected: `node_modules/` created, no errors.

**Step 4: Verify Tauri dev build starts**

```bash
npm run tauri dev
```

Expected: Tauri window opens with Vite React starter page. Close it after confirming.

**Step 5: Clean up starter template**

Replace `src/App.tsx` with minimal shell:

```tsx
import { useState } from "react";
import { ConfigProvider, Layout, theme } from "antd";

const { Sider, Content } = Layout;

function App() {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <ConfigProvider theme={{ algorithm: theme.defaultAlgorithm }}>
      <Layout style={{ minHeight: "100vh" }}>
        <Sider
          collapsible
          collapsed={collapsed}
          onCollapse={setCollapsed}
          width={240}
        >
          <div style={{ padding: 16, color: "#fff", fontWeight: 600 }}>
            OpenMeet
          </div>
        </Sider>
        <Layout>
          <Content style={{ padding: 24 }}>
            <h1>Welcome to OpenMeet</h1>
            <p>AI Meeting Transcription Tool</p>
          </Content>
        </Layout>
      </Layout>
    </ConfigProvider>
  );
}

export default App;
```

**Step 6: Verify the cleaned-up app renders**

```bash
npm run tauri dev
```

Expected: Tauri window shows sidebar + "Welcome to OpenMeet" content area.

**Step 7: Commit**

```bash
git add -A
git commit -m "feat: initialize Tauri + React + TypeScript project skeleton"
```

---

### Task 2: Set Up Python ASR Service Skeleton

**Files:**
- Create: `asr_service/main.py`
- Create: `asr_service/config.py`
- Create: `asr_service/routers/__init__.py`
- Create: `asr_service/routers/health.py`
- Create: `asr_service/routers/jobs.py`
- Create: `asr_service/engines/__init__.py`
- Create: `asr_service/engines/base.py`
- Create: `asr_service/models/__init__.py`
- Create: `asr_service/models/job.py`
- Create: `asr_service/requirements.txt`
- Create: `tests/asr_service/__init__.py`
- Create: `tests/asr_service/test_health.py`

**Step 1: Create Python virtual environment**

```bash
cd /home/yuchen_wu_trusone_com/projects/openMeet
python3 -m venv .venv
source .venv/bin/activate
```

**Step 2: Create requirements.txt**

Create `asr_service/requirements.txt`:

```
fastapi==0.115.*
uvicorn[standard]==0.34.*
pydantic==2.*
python-multipart==0.0.*
httpx==0.28.*
pytest==8.*
pytest-asyncio==0.25.*
```

**Step 3: Install dependencies**

```bash
pip install -r asr_service/requirements.txt
```

**Step 4: Write the failing test for health endpoint**

Create `tests/asr_service/test_health.py`:

```python
import pytest
from httpx import ASGITransport, AsyncClient

from asr_service.main import app


@pytest.mark.asyncio
async def test_health_endpoint():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"
    assert "engines" in data
```

**Step 5: Run test to verify it fails**

```bash
cd /home/yuchen_wu_trusone_com/projects/openMeet
python -m pytest tests/asr_service/test_health.py -v
```

Expected: FAIL with `ModuleNotFoundError: No module named 'asr_service'`

**Step 6: Create config module**

Create `asr_service/__init__.py` (empty file).

Create `asr_service/config.py`:

```python
from pathlib import Path

# Base directories
PROJECT_ROOT = Path(__file__).parent.parent
MODELS_DIR = PROJECT_ROOT / "models"
DATA_DIR = PROJECT_ROOT / "data"

# Server config
HOST = "127.0.0.1"
PORT = 18090

# Supported engines
AVAILABLE_ENGINES = ["whisper", "qwen3", "paraformer"]
DEFAULT_ENGINE = "whisper"
```

**Step 7: Create Job data model**

Create `asr_service/models/__init__.py` (empty file).

Create `asr_service/models/job.py`:

```python
from enum import Enum
from dataclasses import dataclass, field
from typing import Optional
import uuid
import time


class JobMode(str, Enum):
    FILE = "file"
    STREAM = "stream"


class JobStatus(str, Enum):
    IDLE = "idle"
    RUNNING = "running"
    PAUSED = "paused"
    CANCELLED = "cancelled"
    COMPLETED = "completed"
    POST_PROCESSING = "post_processing"
    READY = "ready"


@dataclass
class Segment:
    start: float
    end: float
    text: str
    speaker: Optional[str] = None
    confidence: Optional[float] = None


@dataclass
class TranscriptionJob:
    id: str = field(default_factory=lambda: str(uuid.uuid4())[:8])
    mode: JobMode = JobMode.FILE
    status: JobStatus = JobStatus.IDLE
    engine: str = "whisper"
    model_size: str = "base"
    language: Optional[str] = None
    audio_path: Optional[str] = None
    segments: list[Segment] = field(default_factory=list)
    progress: float = 0.0
    created_at: float = field(default_factory=time.time)
    error: Optional[str] = None
```

**Step 8: Create ASR engine base protocol**

Create `asr_service/engines/__init__.py` (empty file).

Create `asr_service/engines/base.py`:

```python
from typing import Protocol, AsyncIterator, Optional
from dataclasses import dataclass

from asr_service.models.job import Segment


@dataclass
class AudioInput:
    file_path: str
    language: Optional[str] = None
    model_size: str = "base"


@dataclass
class EngineCapabilities:
    name: str
    supported_languages: list[str]
    supports_streaming: bool
    supports_timestamps: bool
    supports_diarization: bool
    model_sizes: list[str]


class ASREngine(Protocol):
    """Protocol for all ASR engines."""

    async def transcribe(
        self, audio: AudioInput, on_progress: Optional[callable] = None
    ) -> list[Segment]: ...

    async def get_capabilities(self) -> EngineCapabilities: ...

    async def load_model(self, model_size: str) -> None: ...

    async def unload_model(self) -> None: ...

    def is_loaded(self) -> bool: ...
```

**Step 9: Create health router**

Create `asr_service/routers/__init__.py` (empty file).

Create `asr_service/routers/health.py`:

```python
from fastapi import APIRouter

from asr_service.config import AVAILABLE_ENGINES

router = APIRouter()


@router.get("/health")
async def health_check():
    return {
        "status": "ok",
        "engines": AVAILABLE_ENGINES,
    }
```

**Step 10: Create jobs router (skeleton)**

Create `asr_service/routers/jobs.py`:

```python
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional

from asr_service.models.job import TranscriptionJob, JobMode, JobStatus

router = APIRouter(prefix="/jobs", tags=["jobs"])

# In-memory job store (will be replaced by proper persistence later)
_jobs: dict[str, TranscriptionJob] = {}


class CreateJobRequest(BaseModel):
    mode: JobMode = JobMode.FILE
    engine: str = "whisper"
    model_size: str = "base"
    language: Optional[str] = None


class JobResponse(BaseModel):
    id: str
    mode: str
    status: str
    engine: str
    model_size: str
    language: Optional[str]
    progress: float
    segment_count: int
    error: Optional[str]


def _job_to_response(job: TranscriptionJob) -> JobResponse:
    return JobResponse(
        id=job.id,
        mode=job.mode.value,
        status=job.status.value,
        engine=job.engine,
        model_size=job.model_size,
        language=job.language,
        progress=job.progress,
        segment_count=len(job.segments),
        error=job.error,
    )


@router.post("", response_model=JobResponse)
async def create_job(req: CreateJobRequest):
    job = TranscriptionJob(
        mode=req.mode,
        engine=req.engine,
        model_size=req.model_size,
        language=req.language,
    )
    _jobs[job.id] = job
    return _job_to_response(job)


@router.get("/{job_id}", response_model=JobResponse)
async def get_job(job_id: str):
    job = _jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return _job_to_response(job)


@router.put("/{job_id}/pause", response_model=JobResponse)
async def pause_job(job_id: str):
    job = _jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    if job.status != JobStatus.RUNNING:
        raise HTTPException(status_code=400, detail="Job is not running")
    job.status = JobStatus.PAUSED
    return _job_to_response(job)


@router.put("/{job_id}/resume", response_model=JobResponse)
async def resume_job(job_id: str):
    job = _jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    if job.status != JobStatus.PAUSED:
        raise HTTPException(status_code=400, detail="Job is not paused")
    job.status = JobStatus.RUNNING
    return _job_to_response(job)


@router.put("/{job_id}/cancel", response_model=JobResponse)
async def cancel_job(job_id: str):
    job = _jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    if job.status not in (JobStatus.RUNNING, JobStatus.PAUSED):
        raise HTTPException(status_code=400, detail="Job cannot be cancelled")
    job.status = JobStatus.CANCELLED
    return _job_to_response(job)
```

**Step 11: Create FastAPI main app**

Create `asr_service/main.py`:

```python
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from asr_service.routers import health, jobs

app = FastAPI(title="OpenMeet ASR Service", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router)
app.include_router(jobs.router)


if __name__ == "__main__":
    import uvicorn
    from asr_service.config import HOST, PORT

    uvicorn.run("asr_service.main:app", host=HOST, port=PORT, reload=True)
```

**Step 12: Run health test to verify it passes**

```bash
cd /home/yuchen_wu_trusone_com/projects/openMeet
python -m pytest tests/asr_service/test_health.py -v
```

Expected: PASS

**Step 13: Write and run jobs API tests**

Create `tests/asr_service/test_jobs.py`:

```python
import pytest
from httpx import ASGITransport, AsyncClient

from asr_service.main import app


@pytest.fixture
async def client():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c


@pytest.mark.asyncio
async def test_create_job(client):
    response = await client.post("/jobs", json={"engine": "whisper", "model_size": "base"})
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "idle"
    assert data["engine"] == "whisper"
    assert "id" in data


@pytest.mark.asyncio
async def test_get_job(client):
    create_resp = await client.post("/jobs", json={})
    job_id = create_resp.json()["id"]
    response = await client.get(f"/jobs/{job_id}")
    assert response.status_code == 200
    assert response.json()["id"] == job_id


@pytest.mark.asyncio
async def test_get_nonexistent_job(client):
    response = await client.get("/jobs/nonexistent")
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_cancel_idle_job_fails(client):
    create_resp = await client.post("/jobs", json={})
    job_id = create_resp.json()["id"]
    response = await client.put(f"/jobs/{job_id}/cancel")
    assert response.status_code == 400


@pytest.mark.asyncio
async def test_pause_non_running_job_fails(client):
    create_resp = await client.post("/jobs", json={})
    job_id = create_resp.json()["id"]
    response = await client.put(f"/jobs/{job_id}/pause")
    assert response.status_code == 400
```

Run:
```bash
python -m pytest tests/asr_service/ -v
```

Expected: All 6 tests PASS.

**Step 14: Verify server starts manually**

```bash
cd /home/yuchen_wu_trusone_com/projects/openMeet
python -m asr_service.main &
sleep 2
curl http://127.0.0.1:18090/health
kill %1
```

Expected: `{"status":"ok","engines":["whisper","qwen3","paraformer"]}`

**Step 15: Commit**

```bash
git add asr_service/ tests/ .venv .gitignore
git commit -m "feat: set up Python ASR Service skeleton with FastAPI, job model, and health/jobs endpoints"
```

---

### Task 3: Implement Tauri Sidecar Management

**Files:**
- Modify: `src-tauri/Cargo.toml` (add dependencies)
- Create: `src-tauri/src/sidecar.rs`
- Modify: `src-tauri/src/main.rs` (register sidecar commands)
- Create: `src/services/asrClient.ts`

**Step 1: Add Rust dependencies for sidecar management**

Add to `src-tauri/Cargo.toml` `[dependencies]` section:

```toml
serde = { version = "1", features = ["derive"] }
serde_json = "1"
reqwest = { version = "0.12", features = ["json"] }
tokio = { version = "1", features = ["full"] }
```

**Step 2: Create sidecar manager in Rust**

Create `src-tauri/src/sidecar.rs`:

```rust
use std::process::{Child, Command};
use std::sync::Mutex;
use tauri::State;

pub struct SidecarState {
    pub process: Mutex<Option<Child>>,
}

impl SidecarState {
    pub fn new() -> Self {
        Self {
            process: Mutex::new(None),
        }
    }
}

#[tauri::command]
pub async fn start_asr_service(state: State<'_, SidecarState>) -> Result<String, String> {
    let mut proc_guard = state.process.lock().map_err(|e| e.to_string())?;

    if proc_guard.is_some() {
        return Ok("ASR service already running".to_string());
    }

    let child = Command::new("python3")
        .args(["-m", "asr_service.main"])
        .current_dir(std::env::current_dir().map_err(|e| e.to_string())?)
        .spawn()
        .map_err(|e| format!("Failed to start ASR service: {}", e))?;

    *proc_guard = Some(child);
    Ok("ASR service started".to_string())
}

#[tauri::command]
pub async fn stop_asr_service(state: State<'_, SidecarState>) -> Result<String, String> {
    let mut proc_guard = state.process.lock().map_err(|e| e.to_string())?;

    if let Some(mut child) = proc_guard.take() {
        child.kill().map_err(|e| e.to_string())?;
        child.wait().map_err(|e| e.to_string())?;
        Ok("ASR service stopped".to_string())
    } else {
        Ok("ASR service not running".to_string())
    }
}

#[tauri::command]
pub async fn check_asr_health() -> Result<String, String> {
    let client = reqwest::Client::new();
    let resp = client
        .get("http://127.0.0.1:18090/health")
        .timeout(std::time::Duration::from_secs(3))
        .send()
        .await
        .map_err(|e| format!("ASR service not reachable: {}", e))?;

    let body = resp
        .text()
        .await
        .map_err(|e| format!("Failed to read response: {}", e))?;

    Ok(body)
}
```

**Step 3: Register sidecar commands in main.rs**

Update `src-tauri/src/main.rs`:

```rust
mod sidecar;

use sidecar::SidecarState;

fn main() {
    tauri::Builder::default()
        .manage(SidecarState::new())
        .invoke_handler(tauri::generate_handler![
            sidecar::start_asr_service,
            sidecar::stop_asr_service,
            sidecar::check_asr_health,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

**Step 4: Create TypeScript ASR client**

Create `src/services/asrClient.ts`:

```typescript
import { invoke } from "@tauri-apps/api/core";

const ASR_BASE_URL = "http://127.0.0.1:18090";

export async function startAsrService(): Promise<string> {
  return invoke<string>("start_asr_service");
}

export async function stopAsrService(): Promise<string> {
  return invoke<string>("stop_asr_service");
}

export async function checkAsrHealth(): Promise<{
  status: string;
  engines: string[];
}> {
  const resp = await fetch(`${ASR_BASE_URL}/health`);
  return resp.json();
}

export interface CreateJobParams {
  mode?: "file" | "stream";
  engine?: string;
  model_size?: string;
  language?: string | null;
}

export interface JobResponse {
  id: string;
  mode: string;
  status: string;
  engine: string;
  model_size: string;
  language: string | null;
  progress: number;
  segment_count: number;
  error: string | null;
}

export async function createJob(
  params: CreateJobParams = {}
): Promise<JobResponse> {
  const resp = await fetch(`${ASR_BASE_URL}/jobs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  return resp.json();
}

export async function getJob(jobId: string): Promise<JobResponse> {
  const resp = await fetch(`${ASR_BASE_URL}/jobs/${jobId}`);
  return resp.json();
}

export async function pauseJob(jobId: string): Promise<JobResponse> {
  const resp = await fetch(`${ASR_BASE_URL}/jobs/${jobId}/pause`, {
    method: "PUT",
  });
  return resp.json();
}

export async function resumeJob(jobId: string): Promise<JobResponse> {
  const resp = await fetch(`${ASR_BASE_URL}/jobs/${jobId}/resume`, {
    method: "PUT",
  });
  return resp.json();
}

export async function cancelJob(jobId: string): Promise<JobResponse> {
  const resp = await fetch(`${ASR_BASE_URL}/jobs/${jobId}/cancel`, {
    method: "PUT",
  });
  return resp.json();
}
```

**Step 5: Verify Rust compiles**

```bash
cd /home/yuchen_wu_trusone_com/projects/openMeet
npm run tauri build -- --debug 2>&1 | tail -5
```

Expected: Compilation succeeds (or `cargo check` in src-tauri passes).

**Step 6: Commit**

```bash
git add src-tauri/ src/services/
git commit -m "feat: implement Tauri sidecar management for Python ASR service"
```

---

### Task 4: Integrate faster-whisper Engine

**Files:**
- Create: `asr_service/engines/whisper_engine.py`
- Create: `asr_service/processors/__init__.py`
- Create: `asr_service/processors/audio_preprocessor.py`
- Modify: `asr_service/requirements.txt` (add faster-whisper)
- Create: `tests/asr_service/test_whisper_engine.py`

**Step 1: Add faster-whisper to requirements**

Append to `asr_service/requirements.txt`:

```
faster-whisper==1.1.*
```

Install:
```bash
source .venv/bin/activate
pip install faster-whisper==1.1.*
```

**Step 2: Write the failing test for whisper engine**

Create `tests/asr_service/test_whisper_engine.py`:

```python
import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from asr_service.engines.whisper_engine import WhisperEngine
from asr_service.engines.base import AudioInput


@pytest.mark.asyncio
async def test_whisper_engine_capabilities():
    engine = WhisperEngine()
    caps = await engine.get_capabilities()
    assert caps.name == "whisper"
    assert "en" in caps.supported_languages
    assert "zh" in caps.supported_languages
    assert caps.supports_timestamps is True
    assert "base" in caps.model_sizes


@pytest.mark.asyncio
async def test_whisper_engine_not_loaded_initially():
    engine = WhisperEngine()
    assert engine.is_loaded() is False


@pytest.mark.asyncio
async def test_whisper_engine_transcribe_requires_loaded_model():
    engine = WhisperEngine()
    audio = AudioInput(file_path="test.wav")
    with pytest.raises(RuntimeError, match="Model not loaded"):
        await engine.transcribe(audio)
```

**Step 3: Run test to verify it fails**

```bash
python -m pytest tests/asr_service/test_whisper_engine.py -v
```

Expected: FAIL with `ModuleNotFoundError`

**Step 4: Implement WhisperEngine**

Create `asr_service/engines/whisper_engine.py`:

```python
import asyncio
from typing import Optional

from faster_whisper import WhisperModel

from asr_service.engines.base import ASREngine, AudioInput, EngineCapabilities
from asr_service.models.job import Segment


class WhisperEngine:
    """ASR engine wrapping faster-whisper."""

    SUPPORTED_SIZES = ["tiny", "base", "small", "medium", "large-v3"]

    def __init__(self):
        self._model: Optional[WhisperModel] = None
        self._model_size: Optional[str] = None

    async def get_capabilities(self) -> EngineCapabilities:
        return EngineCapabilities(
            name="whisper",
            supported_languages=["en", "zh", "ja", "ko", "de", "fr", "es", "auto"],
            supports_streaming=False,
            supports_timestamps=True,
            supports_diarization=False,
            model_sizes=self.SUPPORTED_SIZES,
        )

    async def load_model(self, model_size: str = "base") -> None:
        if model_size not in self.SUPPORTED_SIZES:
            raise ValueError(f"Unsupported model size: {model_size}")
        if self._model and self._model_size == model_size:
            return

        await self.unload_model()

        def _load():
            return WhisperModel(
                model_size,
                device="auto",
                compute_type="auto",
            )

        self._model = await asyncio.to_thread(_load)
        self._model_size = model_size

    async def unload_model(self) -> None:
        if self._model:
            del self._model
            self._model = None
            self._model_size = None

    def is_loaded(self) -> bool:
        return self._model is not None

    async def transcribe(
        self,
        audio: AudioInput,
        on_progress: Optional[callable] = None,
    ) -> list[Segment]:
        if not self._model:
            raise RuntimeError("Model not loaded. Call load_model() first.")

        model_ref = self._model
        language = audio.language if audio.language != "auto" else None

        def _transcribe():
            segments_gen, info = model_ref.transcribe(
                audio.file_path,
                language=language,
                beam_size=5,
                word_timestamps=True,
                vad_filter=True,
            )
            results = []
            for seg in segments_gen:
                results.append(
                    Segment(
                        start=round(seg.start, 3),
                        end=round(seg.end, 3),
                        text=seg.text.strip(),
                        confidence=round(seg.avg_logprob, 3) if seg.avg_logprob else None,
                    )
                )
            return results

        return await asyncio.to_thread(_transcribe)
```

**Step 5: Run tests to verify they pass**

```bash
python -m pytest tests/asr_service/test_whisper_engine.py -v
```

Expected: All 3 tests PASS.

**Step 6: Create audio preprocessor**

Create `asr_service/processors/__init__.py` (empty file).

Create `asr_service/processors/audio_preprocessor.py`:

```python
import asyncio
import subprocess
import tempfile
from pathlib import Path
from typing import Optional


async def preprocess_audio(
    input_path: str,
    output_dir: Optional[str] = None,
    sample_rate: int = 16000,
) -> str:
    """Convert audio/video to WAV format suitable for ASR.

    Returns path to the converted WAV file.
    """
    input_file = Path(input_path)
    if not input_file.exists():
        raise FileNotFoundError(f"Input file not found: {input_path}")

    if output_dir:
        out_dir = Path(output_dir)
        out_dir.mkdir(parents=True, exist_ok=True)
    else:
        out_dir = Path(tempfile.mkdtemp(prefix="openmeet_"))

    output_path = out_dir / f"{input_file.stem}_16k.wav"

    cmd = [
        "ffmpeg", "-y",
        "-i", str(input_path),
        "-ar", str(sample_rate),
        "-ac", "1",
        "-c:a", "pcm_s16le",
        str(output_path),
    ]

    def _run():
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
        )
        if result.returncode != 0:
            raise RuntimeError(
                f"ffmpeg conversion failed: {result.stderr[:500]}"
            )
        return str(output_path)

    return await asyncio.to_thread(_run)
```

**Step 7: Commit**

```bash
git add asr_service/ tests/
git commit -m "feat: integrate faster-whisper engine with audio preprocessing"
```

---

### Task 5: Implement File Transcription API Endpoint

**Files:**
- Modify: `asr_service/routers/jobs.py` (add start endpoint with file upload)
- Create: `asr_service/job_manager.py`
- Modify: `asr_service/main.py` (add startup/shutdown hooks)
- Create: `tests/asr_service/test_transcription_flow.py`

**Step 1: Write failing test for transcription start endpoint**

Create `tests/asr_service/test_transcription_flow.py`:

```python
import pytest
from httpx import ASGITransport, AsyncClient

from asr_service.main import app


@pytest.fixture
async def client():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c


@pytest.mark.asyncio
async def test_create_and_start_job_no_file_returns_error(client):
    """Starting a job without providing audio should fail."""
    create_resp = await client.post("/jobs", json={"engine": "whisper"})
    job_id = create_resp.json()["id"]
    start_resp = await client.post(f"/jobs/{job_id}/start")
    assert start_resp.status_code == 400


@pytest.mark.asyncio
async def test_get_job_result_before_completion(client):
    create_resp = await client.post("/jobs", json={})
    job_id = create_resp.json()["id"]
    result_resp = await client.get(f"/jobs/{job_id}/result")
    assert result_resp.status_code == 400
```

**Step 2: Run test to verify it fails**

```bash
python -m pytest tests/asr_service/test_transcription_flow.py -v
```

Expected: FAIL (endpoints don't exist yet)

**Step 3: Implement JobManager**

Create `asr_service/job_manager.py`:

```python
import asyncio
from typing import Optional

from asr_service.models.job import TranscriptionJob, JobStatus, Segment
from asr_service.engines.base import AudioInput
from asr_service.engines.whisper_engine import WhisperEngine
from asr_service.processors.audio_preprocessor import preprocess_audio


class JobManager:
    """Manages transcription job lifecycle."""

    def __init__(self):
        self._jobs: dict[str, TranscriptionJob] = {}
        self._engines: dict[str, WhisperEngine] = {
            "whisper": WhisperEngine(),
        }
        self._running_tasks: dict[str, asyncio.Task] = {}

    @property
    def jobs(self) -> dict[str, TranscriptionJob]:
        return self._jobs

    def get_job(self, job_id: str) -> Optional[TranscriptionJob]:
        return self._jobs.get(job_id)

    def create_job(self, **kwargs) -> TranscriptionJob:
        job = TranscriptionJob(**kwargs)
        self._jobs[job.id] = job
        return job

    async def start_file_transcription(
        self, job_id: str, audio_path: str
    ) -> None:
        job = self._jobs.get(job_id)
        if not job:
            raise ValueError("Job not found")
        if job.status != JobStatus.IDLE:
            raise ValueError("Job already started")

        job.audio_path = audio_path
        job.status = JobStatus.RUNNING

        task = asyncio.create_task(self._run_transcription(job))
        self._running_tasks[job_id] = task

    async def _run_transcription(self, job: TranscriptionJob) -> None:
        try:
            engine = self._engines.get(job.engine)
            if not engine:
                raise ValueError(f"Engine '{job.engine}' not available")

            if not engine.is_loaded():
                job.progress = 5.0
                await engine.load_model(job.model_size)

            job.progress = 10.0

            # Preprocess audio
            wav_path = await preprocess_audio(job.audio_path)
            job.progress = 15.0

            # Transcribe
            audio_input = AudioInput(
                file_path=wav_path,
                language=job.language,
                model_size=job.model_size,
            )

            def _update_progress(pct: float):
                job.progress = 15.0 + pct * 0.85

            segments = await engine.transcribe(audio_input, on_progress=_update_progress)
            job.segments = segments
            job.progress = 100.0
            job.status = JobStatus.COMPLETED

        except asyncio.CancelledError:
            job.status = JobStatus.CANCELLED
        except Exception as e:
            job.status = JobStatus.CANCELLED
            job.error = str(e)

    async def cancel_job(self, job_id: str) -> None:
        task = self._running_tasks.get(job_id)
        if task and not task.done():
            task.cancel()
        job = self._jobs.get(job_id)
        if job:
            job.status = JobStatus.CANCELLED

    async def pause_job(self, job_id: str) -> None:
        job = self._jobs.get(job_id)
        if not job or job.status != JobStatus.RUNNING:
            raise ValueError("Job is not running")
        job.status = JobStatus.PAUSED
        # Note: actual pause of ASR inference requires engine-level support
        # For MVP, we mark status; full pause implemented in Phase 2

    async def resume_job(self, job_id: str) -> None:
        job = self._jobs.get(job_id)
        if not job or job.status != JobStatus.PAUSED:
            raise ValueError("Job is not paused")
        job.status = JobStatus.RUNNING
```

**Step 4: Update jobs router to use JobManager**

Replace `asr_service/routers/jobs.py` with:

```python
from fastapi import APIRouter, HTTPException, UploadFile, File, Form
from pydantic import BaseModel
from typing import Optional
import tempfile
import shutil
from pathlib import Path

from asr_service.models.job import TranscriptionJob, JobStatus

router = APIRouter(prefix="/jobs", tags=["jobs"])

# JobManager will be injected via app state
_manager = None


def set_manager(manager):
    global _manager
    _manager = manager


def get_manager():
    if _manager is None:
        raise RuntimeError("JobManager not initialized")
    return _manager


class CreateJobRequest(BaseModel):
    mode: str = "file"
    engine: str = "whisper"
    model_size: str = "base"
    language: Optional[str] = None


class JobResponse(BaseModel):
    id: str
    mode: str
    status: str
    engine: str
    model_size: str
    language: Optional[str]
    progress: float
    segment_count: int
    error: Optional[str]


class SegmentResponse(BaseModel):
    start: float
    end: float
    text: str
    speaker: Optional[str]
    confidence: Optional[float]


class JobResultResponse(BaseModel):
    id: str
    status: str
    segments: list[SegmentResponse]


def _job_to_response(job: TranscriptionJob) -> JobResponse:
    return JobResponse(
        id=job.id,
        mode=job.mode.value if hasattr(job.mode, "value") else job.mode,
        status=job.status.value if hasattr(job.status, "value") else job.status,
        engine=job.engine,
        model_size=job.model_size,
        language=job.language,
        progress=job.progress,
        segment_count=len(job.segments),
        error=job.error,
    )


@router.post("", response_model=JobResponse)
async def create_job(req: CreateJobRequest):
    manager = get_manager()
    job = manager.create_job(
        engine=req.engine,
        model_size=req.model_size,
        language=req.language,
    )
    return _job_to_response(job)


@router.get("/{job_id}", response_model=JobResponse)
async def get_job(job_id: str):
    manager = get_manager()
    job = manager.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return _job_to_response(job)


@router.post("/{job_id}/start", response_model=JobResponse)
async def start_job(job_id: str, audio_path: Optional[str] = None):
    manager = get_manager()
    job = manager.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    if not job.audio_path and not audio_path:
        raise HTTPException(status_code=400, detail="No audio file provided")
    try:
        path = audio_path or job.audio_path
        await manager.start_file_transcription(job_id, path)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return _job_to_response(job)


@router.post("/{job_id}/upload", response_model=JobResponse)
async def upload_audio(job_id: str, file: UploadFile = File(...)):
    manager = get_manager()
    job = manager.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    # Save uploaded file
    upload_dir = Path(tempfile.mkdtemp(prefix="openmeet_upload_"))
    file_path = upload_dir / file.filename
    with open(file_path, "wb") as f:
        shutil.copyfileobj(file.file, f)

    job.audio_path = str(file_path)
    return _job_to_response(job)


@router.get("/{job_id}/result", response_model=JobResultResponse)
async def get_job_result(job_id: str):
    manager = get_manager()
    job = manager.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    if job.status not in (JobStatus.COMPLETED, JobStatus.READY):
        raise HTTPException(status_code=400, detail="Transcription not complete")
    return JobResultResponse(
        id=job.id,
        status=job.status.value,
        segments=[
            SegmentResponse(
                start=s.start, end=s.end, text=s.text,
                speaker=s.speaker, confidence=s.confidence,
            )
            for s in job.segments
        ],
    )


@router.put("/{job_id}/pause", response_model=JobResponse)
async def pause_job(job_id: str):
    manager = get_manager()
    try:
        await manager.pause_job(job_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return _job_to_response(manager.get_job(job_id))


@router.put("/{job_id}/resume", response_model=JobResponse)
async def resume_job(job_id: str):
    manager = get_manager()
    try:
        await manager.resume_job(job_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return _job_to_response(manager.get_job(job_id))


@router.put("/{job_id}/cancel", response_model=JobResponse)
async def cancel_job(job_id: str):
    manager = get_manager()
    await manager.cancel_job(job_id)
    job = manager.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return _job_to_response(job)
```

**Step 5: Update main.py with lifecycle hooks**

Replace `asr_service/main.py`:

```python
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from asr_service.routers import health, jobs
from asr_service.job_manager import JobManager


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    manager = JobManager()
    jobs.set_manager(manager)
    yield
    # Shutdown: cleanup


app = FastAPI(title="OpenMeet ASR Service", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router)
app.include_router(jobs.router)


if __name__ == "__main__":
    import uvicorn
    from asr_service.config import HOST, PORT

    uvicorn.run("asr_service.main:app", host=HOST, port=PORT, reload=True)
```

**Step 6: Run all tests**

```bash
python -m pytest tests/asr_service/ -v
```

Expected: All tests PASS (update test_jobs.py fixtures if needed to account for JobManager lifecycle).

**Step 7: Commit**

```bash
git add asr_service/ tests/
git commit -m "feat: implement job manager with file transcription flow and upload endpoint"
```

---

### Task 6: Build Frontend — Sidebar + Project List

**Files:**
- Create: `src/stores/projectStore.ts`
- Create: `src/components/Sidebar/index.tsx`
- Create: `src/components/Sidebar/ProjectList.tsx`
- Create: `src/components/Sidebar/ProjectItem.tsx`
- Create: `src/types/index.ts`
- Modify: `src/App.tsx`

**Step 1: Create shared types**

Create `src/types/index.ts`:

```typescript
export interface Project {
  id: string;
  title: string;
  audioPath: string | null;
  durationMs: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface Segment {
  id: string;
  start: number;
  end: number;
  text: string;
  speaker: string | null;
  confidence: number | null;
}

export interface Summary {
  topic: string;
  conclusions: string[];
  actionItems: Array<{ assignee: string; task: string; deadline: string | null }>;
  discussion: Array<{ topic: string; summary: string }>;
  rawMarkdown: string;
  editedMarkdown: string | null;
}

export type JobStatus =
  | "idle"
  | "running"
  | "paused"
  | "cancelled"
  | "completed"
  | "post_processing"
  | "ready";

export type PipelineStep =
  | "transcribing"
  | "itn"
  | "punctuation"
  | "diarizing"
  | "summarizing"
  | null;
```

**Step 2: Create project store**

Create `src/stores/projectStore.ts`:

```typescript
import { create } from "zustand";
import type { Project } from "../types";

interface ProjectStore {
  projects: Project[];
  activeProjectId: string | null;

  addProject: (title: string) => Project;
  setActiveProject: (id: string) => void;
  updateProject: (id: string, updates: Partial<Project>) => void;
  deleteProject: (id: string) => void;
}

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

export const useProjectStore = create<ProjectStore>((set, get) => ({
  projects: [],
  activeProjectId: null,

  addProject: (title: string) => {
    const project: Project = {
      id: generateId(),
      title,
      audioPath: null,
      durationMs: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    set((state) => ({
      projects: [project, ...state.projects],
      activeProjectId: project.id,
    }));
    return project;
  },

  setActiveProject: (id: string) => {
    set({ activeProjectId: id });
  },

  updateProject: (id: string, updates: Partial<Project>) => {
    set((state) => ({
      projects: state.projects.map((p) =>
        p.id === id ? { ...p, ...updates, updatedAt: new Date().toISOString() } : p
      ),
    }));
  },

  deleteProject: (id: string) => {
    set((state) => ({
      projects: state.projects.filter((p) => p.id !== id),
      activeProjectId:
        state.activeProjectId === id ? null : state.activeProjectId,
    }));
  },
}));
```

**Step 3: Create Sidebar components**

Create `src/components/Sidebar/ProjectItem.tsx`:

```tsx
import { Typography, Button, Popconfirm } from "antd";
import { DeleteOutlined, AudioOutlined } from "@ant-design/icons";
import type { Project } from "../../types";

const { Text } = Typography;

interface ProjectItemProps {
  project: Project;
  isActive: boolean;
  onClick: () => void;
  onDelete: () => void;
}

export function ProjectItem({ project, isActive, onClick, onDelete }: ProjectItemProps) {
  const date = new Date(project.createdAt);
  const dateStr = `${date.getMonth() + 1}/${date.getDate()} ${date.getHours()}:${String(date.getMinutes()).padStart(2, "0")}`;

  return (
    <div
      onClick={onClick}
      style={{
        padding: "8px 12px",
        cursor: "pointer",
        borderRadius: 6,
        backgroundColor: isActive ? "rgba(22,119,255,0.1)" : "transparent",
        borderLeft: isActive ? "3px solid #1677ff" : "3px solid transparent",
        marginBottom: 4,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
      }}
    >
      <div style={{ overflow: "hidden" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <AudioOutlined style={{ fontSize: 12, color: "#999" }} />
          <Text
            ellipsis
            strong={isActive}
            style={{ fontSize: 13, maxWidth: 150 }}
          >
            {project.title}
          </Text>
        </div>
        <Text type="secondary" style={{ fontSize: 11 }}>
          {dateStr}
        </Text>
      </div>
      <Popconfirm
        title="Delete this project?"
        onConfirm={(e) => {
          e?.stopPropagation();
          onDelete();
        }}
        onCancel={(e) => e?.stopPropagation()}
      >
        <Button
          type="text"
          size="small"
          icon={<DeleteOutlined />}
          onClick={(e) => e.stopPropagation()}
          style={{ opacity: 0.5 }}
        />
      </Popconfirm>
    </div>
  );
}
```

Create `src/components/Sidebar/ProjectList.tsx`:

```tsx
import { ProjectItem } from "./ProjectItem";
import { useProjectStore } from "../../stores/projectStore";

export function ProjectList() {
  const { projects, activeProjectId, setActiveProject, deleteProject } =
    useProjectStore();

  if (projects.length === 0) {
    return (
      <div style={{ padding: 16, textAlign: "center", color: "#999", fontSize: 12 }}>
        No projects yet
      </div>
    );
  }

  return (
    <div style={{ padding: "4px 8px" }}>
      {projects.map((project) => (
        <ProjectItem
          key={project.id}
          project={project}
          isActive={project.id === activeProjectId}
          onClick={() => setActiveProject(project.id)}
          onDelete={() => deleteProject(project.id)}
        />
      ))}
    </div>
  );
}
```

Create `src/components/Sidebar/index.tsx`:

```tsx
import { Button, Layout } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import { ProjectList } from "./ProjectList";
import { useProjectStore } from "../../stores/projectStore";

const { Sider } = Layout;

interface SidebarProps {
  collapsed: boolean;
  onCollapse: (collapsed: boolean) => void;
}

export function Sidebar({ collapsed, onCollapse }: SidebarProps) {
  const addProject = useProjectStore((s) => s.addProject);

  const handleNewProject = () => {
    const now = new Date();
    const title = `Meeting ${now.getMonth() + 1}/${now.getDate()} ${now.getHours()}:${String(now.getMinutes()).padStart(2, "0")}`;
    addProject(title);
  };

  return (
    <Sider
      collapsible
      collapsed={collapsed}
      onCollapse={onCollapse}
      width={240}
      style={{ background: "#fff", borderRight: "1px solid #f0f0f0" }}
    >
      {!collapsed && (
        <>
          <div
            style={{
              padding: "16px 12px 8px",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <span style={{ fontWeight: 600, fontSize: 15 }}>OpenMeet</span>
            <Button
              type="primary"
              size="small"
              icon={<PlusOutlined />}
              onClick={handleNewProject}
            >
              New
            </Button>
          </div>
          <ProjectList />
        </>
      )}
    </Sider>
  );
}
```

**Step 4: Update App.tsx**

Replace `src/App.tsx`:

```tsx
import { useState } from "react";
import { ConfigProvider, Layout, theme } from "antd";
import { Sidebar } from "./components/Sidebar";

const { Content } = Layout;

function App() {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <ConfigProvider theme={{ algorithm: theme.defaultAlgorithm }}>
      <Layout style={{ minHeight: "100vh" }}>
        <Sidebar collapsed={collapsed} onCollapse={setCollapsed} />
        <Layout>
          <Content style={{ padding: 24, background: "#fafafa" }}>
            <h2>Select or create a project to get started</h2>
          </Content>
        </Layout>
      </Layout>
    </ConfigProvider>
  );
}

export default App;
```

**Step 5: Verify UI renders**

```bash
npm run tauri dev
```

Expected: App shows sidebar with "OpenMeet" title, "New" button. Clicking "New" adds a project item.

**Step 6: Commit**

```bash
git add src/
git commit -m "feat: implement Sidebar with ProjectList, ProjectItem, and project store"
```

---

### Task 7: Build Frontend — Upload, Transcript Panel, Audio Player

**Files:**
- Create: `src/stores/transcriptionStore.ts`
- Create: `src/components/Workspace/index.tsx`
- Create: `src/components/Workspace/TranscriptPanel.tsx`
- Create: `src/components/Workspace/SegmentItem.tsx`
- Create: `src/components/ControlBar/index.tsx`
- Create: `src/components/ControlBar/AudioPlayer.tsx`
- Create: `src/components/ControlBar/ActionButtons.tsx`
- Create: `src/components/StatusBar/index.tsx`
- Modify: `src/App.tsx`

**Step 1: Create transcription store**

Create `src/stores/transcriptionStore.ts`:

```typescript
import { create } from "zustand";
import type { Segment, JobStatus, PipelineStep, Summary } from "../types";
import * as api from "../services/asrClient";

interface TranscriptionStore {
  job: {
    id: string | null;
    mode: "file" | "stream";
    status: JobStatus;
    progress: number;
    pipelineStep: PipelineStep;
  };
  segments: Segment[];
  summary: Summary | null;
  audio: {
    source: "file" | "microphone" | null;
    filePath: string | null;
    objectUrl: string | null;
    duration: number;
    currentTime: number;
    isPlaying: boolean;
    playbackSpeed: number;
  };

  setAudioFile: (filePath: string, objectUrl: string) => void;
  startTranscription: (engine: string, modelSize: string, language: string | null) => Promise<void>;
  pollJobStatus: (jobId: string) => Promise<void>;
  setSegments: (segments: Segment[]) => void;
  setJobStatus: (status: JobStatus) => void;
  setProgress: (progress: number) => void;
  seekTo: (time: number) => void;
  setIsPlaying: (isPlaying: boolean) => void;
  setCurrentTime: (time: number) => void;
  setDuration: (duration: number) => void;
  setPlaybackSpeed: (speed: number) => void;
  updateSegmentText: (id: string, text: string) => void;
  reset: () => void;
}

const initialState = {
  job: {
    id: null as string | null,
    mode: "file" as const,
    status: "idle" as JobStatus,
    progress: 0,
    pipelineStep: null as PipelineStep,
  },
  segments: [] as Segment[],
  summary: null as Summary | null,
  audio: {
    source: null as "file" | "microphone" | null,
    filePath: null as string | null,
    objectUrl: null as string | null,
    duration: 0,
    currentTime: 0,
    isPlaying: false,
    playbackSpeed: 1,
  },
};

export const useTranscriptionStore = create<TranscriptionStore>((set, get) => ({
  ...initialState,

  setAudioFile: (filePath, objectUrl) => {
    set({
      audio: { ...get().audio, source: "file", filePath, objectUrl },
    });
  },

  startTranscription: async (engine, modelSize, language) => {
    const { audio } = get();
    if (!audio.filePath) return;

    const jobResp = await api.createJob({
      mode: "file",
      engine,
      model_size: modelSize,
      language,
    });

    set({
      job: { ...get().job, id: jobResp.id, status: "running", progress: 0 },
    });

    // Upload file and start
    await fetch(`http://127.0.0.1:18090/jobs/${jobResp.id}/start?audio_path=${encodeURIComponent(audio.filePath)}`, {
      method: "POST",
    });

    // Start polling
    get().pollJobStatus(jobResp.id);
  },

  pollJobStatus: async (jobId) => {
    const poll = async () => {
      const jobResp = await api.getJob(jobId);
      set({
        job: {
          ...get().job,
          status: jobResp.status as JobStatus,
          progress: jobResp.progress,
        },
      });

      if (jobResp.status === "completed" || jobResp.status === "ready") {
        // Fetch results
        const resp = await fetch(`http://127.0.0.1:18090/jobs/${jobId}/result`);
        if (resp.ok) {
          const data = await resp.json();
          const segments: Segment[] = data.segments.map(
            (s: any, i: number) => ({
              id: `seg-${i}`,
              ...s,
            })
          );
          set({ segments });
        }
        return;
      }

      if (
        jobResp.status === "cancelled" ||
        jobResp.error
      ) {
        return;
      }

      // Continue polling
      setTimeout(() => poll(), 1000);
    };

    poll();
  },

  setSegments: (segments) => set({ segments }),
  setJobStatus: (status) => set({ job: { ...get().job, status } }),
  setProgress: (progress) => set({ job: { ...get().job, progress } }),
  seekTo: (time) => set({ audio: { ...get().audio, currentTime: time } }),
  setIsPlaying: (isPlaying) => set({ audio: { ...get().audio, isPlaying } }),
  setCurrentTime: (time) => set({ audio: { ...get().audio, currentTime: time } }),
  setDuration: (duration) => set({ audio: { ...get().audio, duration } }),
  setPlaybackSpeed: (speed) => set({ audio: { ...get().audio, playbackSpeed: speed } }),

  updateSegmentText: (id, text) => {
    set({
      segments: get().segments.map((s) =>
        s.id === id ? { ...s, text } : s
      ),
    });
  },

  reset: () => set(initialState),
}));
```

**Step 2: Create SegmentItem component**

Create `src/components/Workspace/SegmentItem.tsx`:

```tsx
import { Tag, Typography } from "antd";
import type { Segment } from "../../types";
import { useTranscriptionStore } from "../../stores/transcriptionStore";

const { Text } = Typography;

interface SegmentItemProps {
  segment: Segment;
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function SegmentItem({ segment }: SegmentItemProps) {
  const seekTo = useTranscriptionStore((s) => s.seekTo);

  return (
    <div style={{ display: "flex", gap: 8, padding: "6px 0", alignItems: "flex-start" }}>
      <Text
        code
        style={{ cursor: "pointer", flexShrink: 0, fontSize: 12 }}
        onClick={() => seekTo(segment.start)}
      >
        {formatTime(segment.start)}
      </Text>
      {segment.speaker && (
        <Tag color="blue" style={{ flexShrink: 0, fontSize: 11 }}>
          {segment.speaker}
        </Tag>
      )}
      <Text style={{ flex: 1, lineHeight: 1.6 }}>{segment.text}</Text>
    </div>
  );
}
```

**Step 3: Create TranscriptPanel**

Create `src/components/Workspace/TranscriptPanel.tsx`:

```tsx
import { Empty } from "antd";
import { SegmentItem } from "./SegmentItem";
import { useTranscriptionStore } from "../../stores/transcriptionStore";

export function TranscriptPanel() {
  const segments = useTranscriptionStore((s) => s.segments);
  const status = useTranscriptionStore((s) => s.job.status);

  if (segments.length === 0 && status === "idle") {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%" }}>
        <Empty description="Upload audio or start recording to begin transcription" />
      </div>
    );
  }

  return (
    <div style={{ padding: 16, overflowY: "auto", height: "100%" }}>
      {segments.map((seg) => (
        <SegmentItem key={seg.id} segment={seg} />
      ))}
      {status === "running" && (
        <div style={{ padding: 8, color: "#999", fontSize: 12 }}>
          Transcribing...
        </div>
      )}
    </div>
  );
}
```

**Step 4: Create Workspace container**

Create `src/components/Workspace/index.tsx`:

```tsx
import { TranscriptPanel } from "./TranscriptPanel";

export function Workspace() {
  return (
    <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
      <div style={{ flex: 1, overflow: "auto", borderRight: "1px solid #f0f0f0" }}>
        <TranscriptPanel />
      </div>
      {/* SummaryPanel will be added in Phase 3 */}
    </div>
  );
}
```

**Step 5: Create AudioPlayer**

Create `src/components/ControlBar/AudioPlayer.tsx`:

```tsx
import { useRef, useEffect } from "react";
import { Button, Slider, Space, Typography } from "antd";
import {
  PlayCircleOutlined,
  PauseCircleOutlined,
  StepBackwardOutlined,
  StepForwardOutlined,
} from "@ant-design/icons";
import { useTranscriptionStore } from "../../stores/transcriptionStore";

const { Text } = Typography;

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function AudioPlayer() {
  const audioRef = useRef<HTMLAudioElement>(null);
  const {
    audio,
    setIsPlaying,
    setCurrentTime,
    setDuration,
    seekTo,
    setPlaybackSpeed,
  } = useTranscriptionStore();

  useEffect(() => {
    if (!audioRef.current || !audio.objectUrl) return;
    audioRef.current.src = audio.objectUrl;
  }, [audio.objectUrl]);

  useEffect(() => {
    if (!audioRef.current) return;
    audioRef.current.playbackRate = audio.playbackSpeed;
  }, [audio.playbackSpeed]);

  // Sync external seekTo calls
  useEffect(() => {
    if (!audioRef.current) return;
    const diff = Math.abs(audioRef.current.currentTime - audio.currentTime);
    if (diff > 1) {
      audioRef.current.currentTime = audio.currentTime;
      if (!audio.isPlaying) {
        audioRef.current.play();
        setIsPlaying(true);
      }
    }
  }, [audio.currentTime]);

  const togglePlay = () => {
    if (!audioRef.current) return;
    if (audio.isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
    } else {
      audioRef.current.play();
      setIsPlaying(true);
    }
  };

  const skip = (delta: number) => {
    if (!audioRef.current) return;
    audioRef.current.currentTime += delta;
  };

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, flex: 1 }}>
      <audio
        ref={audioRef}
        onTimeUpdate={() => {
          if (audioRef.current) setCurrentTime(audioRef.current.currentTime);
        }}
        onLoadedMetadata={() => {
          if (audioRef.current) setDuration(audioRef.current.duration);
        }}
        onEnded={() => setIsPlaying(false)}
      />
      <Space size={4}>
        <Button
          type="text"
          size="small"
          icon={<StepBackwardOutlined />}
          onClick={() => skip(-5)}
          disabled={!audio.objectUrl}
        />
        <Button
          type="text"
          icon={audio.isPlaying ? <PauseCircleOutlined /> : <PlayCircleOutlined />}
          onClick={togglePlay}
          disabled={!audio.objectUrl}
          style={{ fontSize: 20 }}
        />
        <Button
          type="text"
          size="small"
          icon={<StepForwardOutlined />}
          onClick={() => skip(5)}
          disabled={!audio.objectUrl}
        />
      </Space>
      <Slider
        style={{ flex: 1, margin: "0 8px" }}
        min={0}
        max={audio.duration || 100}
        step={0.1}
        value={audio.currentTime}
        onChange={(val) => {
          if (audioRef.current) audioRef.current.currentTime = val;
          setCurrentTime(val);
        }}
        tooltip={{ formatter: (val) => formatTime(val || 0) }}
        disabled={!audio.objectUrl}
      />
      <Text style={{ fontSize: 12, whiteSpace: "nowrap" }}>
        {formatTime(audio.currentTime)} / {formatTime(audio.duration)}
      </Text>
    </div>
  );
}
```

**Step 6: Create ActionButtons**

Create `src/components/ControlBar/ActionButtons.tsx`:

```tsx
import { Button, Space, Upload, message } from "antd";
import {
  UploadOutlined,
  AudioOutlined,
  ExportOutlined,
} from "@ant-design/icons";
import { useTranscriptionStore } from "../../stores/transcriptionStore";
import { useProjectStore } from "../../stores/projectStore";

export function ActionButtons() {
  const { setAudioFile, startTranscription, job } = useTranscriptionStore();
  const activeProjectId = useProjectStore((s) => s.activeProjectId);
  const updateProject = useProjectStore((s) => s.updateProject);

  const handleUpload = (file: File) => {
    const objectUrl = URL.createObjectURL(file);
    // For Tauri, we use the actual file path
    // For dev, use object URL as fallback
    const filePath = (file as any).path || file.name;
    setAudioFile(filePath, objectUrl);

    if (activeProjectId) {
      updateProject(activeProjectId, { audioPath: filePath });
    }

    message.success(`Loaded: ${file.name}`);

    // Auto-start transcription
    startTranscription("whisper", "base", null);

    return false; // prevent default upload
  };

  return (
    <Space>
      <Upload
        accept="audio/*,video/*,.mp3,.wav,.m4a,.mp4,.mkv,.flac,.ogg"
        showUploadList={false}
        beforeUpload={handleUpload}
      >
        <Button
          icon={<UploadOutlined />}
          disabled={job.status === "running"}
        >
          Upload
        </Button>
      </Upload>
      <Button
        icon={<AudioOutlined />}
        disabled
        title="Real-time recording (Phase 2)"
      >
        Record
      </Button>
      <Button
        icon={<ExportOutlined />}
        disabled
        title="Export (Phase 3)"
      >
        Export
      </Button>
    </Space>
  );
}
```

**Step 7: Create ControlBar**

Create `src/components/ControlBar/index.tsx`:

```tsx
import { AudioPlayer } from "./AudioPlayer";
import { ActionButtons } from "./ActionButtons";

export function ControlBar() {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 16,
        padding: "8px 16px",
        borderTop: "1px solid #f0f0f0",
        background: "#fff",
      }}
    >
      <AudioPlayer />
      <ActionButtons />
    </div>
  );
}
```

**Step 8: Create StatusBar**

Create `src/components/StatusBar/index.tsx`:

```tsx
import { Progress, Space, Typography, Tag } from "antd";
import { useTranscriptionStore } from "../../stores/transcriptionStore";

const { Text } = Typography;

export function StatusBar() {
  const { job } = useTranscriptionStore();

  const statusColor: Record<string, string> = {
    idle: "default",
    running: "processing",
    paused: "warning",
    completed: "success",
    post_processing: "processing",
    ready: "success",
    cancelled: "error",
  };

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "4px 16px",
        borderTop: "1px solid #f0f0f0",
        background: "#fafafa",
        fontSize: 12,
      }}
    >
      <Tag color={statusColor[job.status] || "default"} style={{ fontSize: 11 }}>
        {job.status.toUpperCase()}
      </Tag>
      {job.status === "running" && (
        <Progress
          percent={Math.round(job.progress)}
          size="small"
          style={{ width: 200, margin: 0 }}
        />
      )}
      <Space style={{ marginLeft: "auto" }}>
        <Text type="secondary">OpenMeet v0.1.0</Text>
      </Space>
    </div>
  );
}
```

**Step 9: Wire everything in App.tsx**

Replace `src/App.tsx`:

```tsx
import { useState } from "react";
import { ConfigProvider, Layout, theme } from "antd";
import { Sidebar } from "./components/Sidebar";
import { Workspace } from "./components/Workspace";
import { ControlBar } from "./components/ControlBar";
import { StatusBar } from "./components/StatusBar";

const { Content } = Layout;

function App() {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <ConfigProvider theme={{ algorithm: theme.defaultAlgorithm }}>
      <Layout style={{ minHeight: "100vh" }}>
        <Sidebar collapsed={collapsed} onCollapse={setCollapsed} />
        <Layout style={{ display: "flex", flexDirection: "column" }}>
          <Content
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
            }}
          >
            <Workspace />
          </Content>
          <ControlBar />
          <StatusBar />
        </Layout>
      </Layout>
    </ConfigProvider>
  );
}

export default App;
```

**Step 10: Verify full UI renders**

```bash
npm run tauri dev
```

Expected: App shows sidebar, workspace with empty state, audio player controls, upload button, and status bar.

**Step 11: Commit**

```bash
git add src/
git commit -m "feat: implement Workspace, TranscriptPanel, AudioPlayer, ControlBar, and StatusBar"
```

---

### Task 8: End-to-End Integration Test

**Goal:** Verify the complete flow: Upload WAV → Whisper transcribe → Display text → Click timestamp to seek.

**Step 1: Start ASR service and Tauri app**

Terminal 1:
```bash
cd /home/yuchen_wu_trusone_com/projects/openMeet
source .venv/bin/activate
python -m asr_service.main
```

Terminal 2:
```bash
cd /home/yuchen_wu_trusone_com/projects/openMeet
npm run tauri dev
```

**Step 2: Manual E2E test checklist**

- [ ] Click "New" in sidebar → creates a project
- [ ] Click "Upload" → select a WAV/MP3 file
- [ ] Status bar shows "RUNNING" with progress bar advancing
- [ ] Transcript segments appear in real-time as transcription progresses
- [ ] Status bar shows "COMPLETED" when done
- [ ] Audio player shows correct duration
- [ ] Click play button → audio plays
- [ ] Click a timestamp in transcript → audio seeks to that position
- [ ] Progress slider tracks audio position

**Step 3: Fix any issues discovered during E2E test**

Address any integration issues found during manual testing.

**Step 4: Commit any fixes**

```bash
git add -A
git commit -m "fix: address integration issues from E2E testing"
```

---

## Phase 2: Multi-Model + Real-time Recording + Diarization (Week 3-4)

> Detailed implementation plan to be created at start of Phase 2.

### Task 9: Integrate Qwen3-ASR Engine
- Files: `asr_service/engines/qwen3_engine.py`, tests
- Install `qwen-asr` package, implement QwenEngine class following ASREngine protocol
- Handle model download and VRAM management

### Task 10: Integrate FunASR Paraformer Engine
- Files: `asr_service/engines/paraformer_engine.py`, tests
- Reuse model files from `meeting/models/` directory
- Implement ParaformerEngine class

### Task 11: Engine Selector UI
- Files: `src/components/HeaderBar/EngineSelector.tsx`, `ModelSizeSelector.tsx`, `LanguageSelector.tsx`
- Dropdown to switch between Whisper/Qwen3/Paraformer
- Auto-recommend based on language selection

### Task 12: Real-time Audio Capture (Rust)
- Files: `src-tauri/src/utils/audio_capture.rs`
- Use `cpal` crate for microphone capture
- Send PCM chunks every 300ms via WebSocket to Python service

### Task 13: WebSocket Streaming Transcription
- Files: `asr_service/routers/stream.py`, frontend WebSocket client
- Real-time VAD + streaming ASR
- Display text as it arrives

### Task 14: Recording Controls (Start/Pause/Resume/Stop)
- Files: `src/components/ControlBar/RecordButton.tsx`
- Implement full recording state machine in frontend
- Wire to job pause/resume/cancel APIs

### Task 15: Speaker Diarization (Dual: CAMPPlus + pyannote)
- Files: `asr_service/processors/diarization/campplus.py`, `pyannote.py`, `factory.py`
- Language-adaptive selection
- SpeakerBadge component with rename

### Task 16: Language-Adaptive Post-Processing
- Files: `asr_service/processors/factory.py`, `vad/fsmn_vad.py`, `punctuation/ct_transformer.py`
- FSMN-VAD + CT-Transformer for Chinese path
- Silero-VAD for general path

### Task 17: ITN Integration
- Files: `asr_service/processors/itn.py`
- WeTextProcessing for Chinese ITN
- Unit tests with numbers/dates/currency/phone patterns

### Task 18: Model Download Manager UI
- Files: `src/components/Settings/ModelManager.tsx`
- Show available/installed models
- Download progress, delete models

---

## Phase 3: Smart Minutes + Auto Pipeline (Week 5-6)

> Detailed implementation plan to be created at start of Phase 3.

### Task 19: Ollama Integration
### Task 20: Meeting Summary Prompt Templates
### Task 21: PostProcessingPipeline (auto-trigger)
### Task 22: SummaryPanel (stream display)
### Task 23: Pipeline Status Indicator
### Task 24: Summary Editor (Markdown)
### Task 25: Export Markdown
### Task 26: Export Word (python-docx)
### Task 27: Export PDF
### Task 28: Settings Dialog

---

## Phase 4: Commercial API + Productization (Week 7-8)

> Detailed implementation plan to be created at start of Phase 4.

### Task 29: OpenAI Whisper API Adapter
### Task 30: Alibaba Cloud ASR API Adapter
### Task 31: API Key Management UI
### Task 32: Auto-Degradation Strategy
### Task 33: System Audio Capture
### Task 34: Full-Text Search
### Task 35: App Signing & Packaging
### Task 36: Auto-Update Mechanism
### Task 37: First-Run Guide
### Task 38: Performance Optimization
### Task 39: Error Handling & Polish
### Task 40: Build Installers & Release

---

## Appendix: Key Commands Reference

```bash
# Start dev environment
source .venv/bin/activate
python -m asr_service.main              # Start ASR service
npm run tauri dev                        # Start Tauri app

# Run tests
python -m pytest tests/ -v              # Python tests
python -m pytest tests/ --cov=asr_service --cov-report=term-missing  # With coverage

# Build
npm run tauri build                     # Production build

# Ollama (Phase 3)
ollama serve                            # Start Ollama
ollama pull qwen2.5:7b                  # Download model
```
