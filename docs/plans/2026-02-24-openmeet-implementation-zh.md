# OpenMeet 实施计划

> 本文件为 `2026-02-24-openmeet-implementation.md` 的中文版本

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**目标:** 构建一个本地优先、多模型 AI 会议转录桌面应用，技术栈为 Tauri + React + Python ASR Sidecar。

**架构:** Tauri 桌面外壳 (Rust) 管理一个 Python FastAPI sidecar 进程用于 ASR 处理。三个引擎 (faster-whisper、Qwen3-ASR、Paraformer) 位于统一的适配器接口之后。Ollama 用于 LLM 摘要生成。语言自适应后处理管线 (VAD、ITN、标点、说话人分离)。

**技术栈:** Tauri 2.x, React 19, TypeScript, Vite, Zustand, Ant Design, Python 3.12, FastAPI, faster-whisper, qwen-asr, FunASR, pyannote-audio, Ollama, SQLite

**参考设计:** `docs/plans/2026-02-24-openmeet-design.md`

---

## 阶段 1: 基础转录工具 (第 1-2 周)

**阶段目标:** 一个可运行的 Tauri 桌面应用，能够上传音频、使用 Whisper 转录、显示带时间戳的文本，以及点击跳转播放音频。

---

### 任务 1: 初始化 Tauri + React + TypeScript 项目

**涉及文件:**
- 创建: `package.json`, `tsconfig.json`, `vite.config.ts`
- 创建: `src/main.tsx`, `src/App.tsx`, `src/App.css`
- 创建: `src-tauri/Cargo.toml`, `src-tauri/src/main.rs`, `src-tauri/tauri.conf.json`
- 创建: `src-tauri/capabilities/default.json`

**步骤 1: 脚手架搭建 Tauri + React 项目**

运行:
```bash
cd /home/yuchen_wu_trusone_com/projects/openMeet
npm create tauri-app@latest app -- --template react-ts --manager npm
```

预期结果: 生成一个包含 Tauri + React + TypeScript 骨架的 `app/` 目录。

**步骤 2: 将 app 内容移动到项目根目录**

```bash
# Move everything from app/ to project root
cp -r app/* app/.* . 2>/dev/null || true
rm -rf app/
```

**步骤 3: 安装核心前端依赖**

```bash
npm install
npm install zustand antd @ant-design/icons axios
npm install -D @types/node
```

预期结果: `node_modules/` 创建成功，无报错。

**步骤 4: 验证 Tauri 开发构建能够启动**

```bash
npm run tauri dev
```

预期结果: Tauri 窗口打开并显示 Vite React 启动页面。确认后关闭窗口。

**步骤 5: 清理启动模板**

将 `src/App.tsx` 替换为最小外壳:

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

**步骤 6: 验证清理后的应用渲染正常**

```bash
npm run tauri dev
```

预期结果: Tauri 窗口显示侧边栏 + "Welcome to OpenMeet" 内容区域。

**步骤 7: 提交**

```bash
git add -A
git commit -m "feat: initialize Tauri + React + TypeScript project skeleton"
```

---

### 任务 2: 搭建 Python ASR 服务骨架

**涉及文件:**
- 创建: `asr_service/main.py`
- 创建: `asr_service/config.py`
- 创建: `asr_service/routers/__init__.py`
- 创建: `asr_service/routers/health.py`
- 创建: `asr_service/routers/jobs.py`
- 创建: `asr_service/engines/__init__.py`
- 创建: `asr_service/engines/base.py`
- 创建: `asr_service/models/__init__.py`
- 创建: `asr_service/models/job.py`
- 创建: `asr_service/requirements.txt`
- 创建: `tests/asr_service/__init__.py`
- 创建: `tests/asr_service/test_health.py`

**步骤 1: 创建 Python 虚拟环境**

```bash
cd /home/yuchen_wu_trusone_com/projects/openMeet
python3 -m venv .venv
source .venv/bin/activate
```

**步骤 2: 创建 requirements.txt**

创建 `asr_service/requirements.txt`:

```
fastapi==0.115.*
uvicorn[standard]==0.34.*
pydantic==2.*
python-multipart==0.0.*
httpx==0.28.*
pytest==8.*
pytest-asyncio==0.25.*
```

**步骤 3: 安装依赖**

```bash
pip install -r asr_service/requirements.txt
```

**步骤 4: 编写健康检查端点的失败测试**

创建 `tests/asr_service/test_health.py`:

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

**步骤 5: 运行测试验证其失败**

```bash
cd /home/yuchen_wu_trusone_com/projects/openMeet
python -m pytest tests/asr_service/test_health.py -v
```

预期结果: 失败，报错 `ModuleNotFoundError: No module named 'asr_service'`

**步骤 6: 创建配置模块**

创建 `asr_service/__init__.py` (空文件)。

创建 `asr_service/config.py`:

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

**步骤 7: 创建 Job 数据模型**

创建 `asr_service/models/__init__.py` (空文件)。

创建 `asr_service/models/job.py`:

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

**步骤 8: 创建 ASR 引擎基础协议**

创建 `asr_service/engines/__init__.py` (空文件)。

创建 `asr_service/engines/base.py`:

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

**步骤 9: 创建健康检查路由**

创建 `asr_service/routers/__init__.py` (空文件)。

创建 `asr_service/routers/health.py`:

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

**步骤 10: 创建 jobs 路由 (骨架)**

创建 `asr_service/routers/jobs.py`:

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

**步骤 11: 创建 FastAPI 主应用**

创建 `asr_service/main.py`:

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

**步骤 12: 运行健康检查测试验证其通过**

```bash
cd /home/yuchen_wu_trusone_com/projects/openMeet
python -m pytest tests/asr_service/test_health.py -v
```

预期结果: 通过

**步骤 13: 编写并运行 jobs API 测试**

创建 `tests/asr_service/test_jobs.py`:

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

运行:
```bash
python -m pytest tests/asr_service/ -v
```

预期结果: 全部 6 个测试通过。

**步骤 14: 手动验证服务器启动**

```bash
cd /home/yuchen_wu_trusone_com/projects/openMeet
python -m asr_service.main &
sleep 2
curl http://127.0.0.1:18090/health
kill %1
```

预期结果: `{"status":"ok","engines":["whisper","qwen3","paraformer"]}`

**步骤 15: 提交**

```bash
git add asr_service/ tests/ .venv .gitignore
git commit -m "feat: set up Python ASR Service skeleton with FastAPI, job model, and health/jobs endpoints"
```

---

### 任务 3: 实现 Tauri Sidecar 管理

**涉及文件:**
- 修改: `src-tauri/Cargo.toml` (添加依赖)
- 创建: `src-tauri/src/sidecar.rs`
- 修改: `src-tauri/src/main.rs` (注册 sidecar 命令)
- 创建: `src/services/asrClient.ts`

**步骤 1: 添加 Rust 依赖用于 sidecar 管理**

在 `src-tauri/Cargo.toml` 的 `[dependencies]` 部分添加:

```toml
serde = { version = "1", features = ["derive"] }
serde_json = "1"
reqwest = { version = "0.12", features = ["json"] }
tokio = { version = "1", features = ["full"] }
```

**步骤 2: 在 Rust 中创建 sidecar 管理器**

创建 `src-tauri/src/sidecar.rs`:

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

**步骤 3: 在 main.rs 中注册 sidecar 命令**

更新 `src-tauri/src/main.rs`:

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

**步骤 4: 创建 TypeScript ASR 客户端**

创建 `src/services/asrClient.ts`:

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

**步骤 5: 验证 Rust 编译通过**

```bash
cd /home/yuchen_wu_trusone_com/projects/openMeet
npm run tauri build -- --debug 2>&1 | tail -5
```

预期结果: 编译成功 (或在 src-tauri 中 `cargo check` 通过)。

**步骤 6: 提交**

```bash
git add src-tauri/ src/services/
git commit -m "feat: implement Tauri sidecar management for Python ASR service"
```

---

### 任务 4: 集成 faster-whisper 引擎

**涉及文件:**
- 创建: `asr_service/engines/whisper_engine.py`
- 创建: `asr_service/processors/__init__.py`
- 创建: `asr_service/processors/audio_preprocessor.py`
- 修改: `asr_service/requirements.txt` (添加 faster-whisper)
- 创建: `tests/asr_service/test_whisper_engine.py`

**步骤 1: 将 faster-whisper 添加到 requirements**

在 `asr_service/requirements.txt` 末尾追加:

```
faster-whisper==1.1.*
```

安装:
```bash
source .venv/bin/activate
pip install faster-whisper==1.1.*
```

**步骤 2: 编写 whisper 引擎的失败测试**

创建 `tests/asr_service/test_whisper_engine.py`:

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

**步骤 3: 运行测试验证其失败**

```bash
python -m pytest tests/asr_service/test_whisper_engine.py -v
```

预期结果: 失败，报错 `ModuleNotFoundError`

**步骤 4: 实现 WhisperEngine**

创建 `asr_service/engines/whisper_engine.py`:

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

**步骤 5: 运行测试验证其通过**

```bash
python -m pytest tests/asr_service/test_whisper_engine.py -v
```

预期结果: 全部 3 个测试通过。

**步骤 6: 创建音频预处理器**

创建 `asr_service/processors/__init__.py` (空文件)。

创建 `asr_service/processors/audio_preprocessor.py`:

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

**步骤 7: 提交**

```bash
git add asr_service/ tests/
git commit -m "feat: integrate faster-whisper engine with audio preprocessing"
```

---

### 任务 5: 实现文件转录 API 端点

**涉及文件:**
- 修改: `asr_service/routers/jobs.py` (添加带文件上传的启动端点)
- 创建: `asr_service/job_manager.py`
- 修改: `asr_service/main.py` (添加启动/关闭钩子)
- 创建: `tests/asr_service/test_transcription_flow.py`

**步骤 1: 编写转录启动端点的失败测试**

创建 `tests/asr_service/test_transcription_flow.py`:

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

**步骤 2: 运行测试验证其失败**

```bash
python -m pytest tests/asr_service/test_transcription_flow.py -v
```

预期结果: 失败 (端点尚未实现)

**步骤 3: 实现 JobManager**

创建 `asr_service/job_manager.py`:

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

**步骤 4: 更新 jobs 路由以使用 JobManager**

将 `asr_service/routers/jobs.py` 替换为:

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

**步骤 5: 更新 main.py 添加生命周期钩子**

替换 `asr_service/main.py`:

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

**步骤 6: 运行所有测试**

```bash
python -m pytest tests/asr_service/ -v
```

预期结果: 全部测试通过 (如需要，更新 test_jobs.py 的 fixture 以适配 JobManager 生命周期)。

**步骤 7: 提交**

```bash
git add asr_service/ tests/
git commit -m "feat: implement job manager with file transcription flow and upload endpoint"
```

---

### 任务 6: 构建前端 — 侧边栏 + 项目列表

**涉及文件:**
- 创建: `src/stores/projectStore.ts`
- 创建: `src/components/Sidebar/index.tsx`
- 创建: `src/components/Sidebar/ProjectList.tsx`
- 创建: `src/components/Sidebar/ProjectItem.tsx`
- 创建: `src/types/index.ts`
- 修改: `src/App.tsx`

**步骤 1: 创建共享类型定义**

创建 `src/types/index.ts`:

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

**步骤 2: 创建项目 store**

创建 `src/stores/projectStore.ts`:

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

**步骤 3: 创建侧边栏组件**

创建 `src/components/Sidebar/ProjectItem.tsx`:

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

创建 `src/components/Sidebar/ProjectList.tsx`:

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

创建 `src/components/Sidebar/index.tsx`:

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

**步骤 4: 更新 App.tsx**

替换 `src/App.tsx`:

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

**步骤 5: 验证 UI 渲染正常**

```bash
npm run tauri dev
```

预期结果: 应用显示侧边栏，包含 "OpenMeet" 标题和 "New" 按钮。点击 "New" 可添加项目条目。

**步骤 6: 提交**

```bash
git add src/
git commit -m "feat: implement Sidebar with ProjectList, ProjectItem, and project store"
```

---

### 任务 7: 构建前端 — 上传、转录面板、音频播放器

**涉及文件:**
- 创建: `src/stores/transcriptionStore.ts`
- 创建: `src/components/Workspace/index.tsx`
- 创建: `src/components/Workspace/TranscriptPanel.tsx`
- 创建: `src/components/Workspace/SegmentItem.tsx`
- 创建: `src/components/ControlBar/index.tsx`
- 创建: `src/components/ControlBar/AudioPlayer.tsx`
- 创建: `src/components/ControlBar/ActionButtons.tsx`
- 创建: `src/components/StatusBar/index.tsx`
- 修改: `src/App.tsx`

**步骤 1: 创建转录 store**

创建 `src/stores/transcriptionStore.ts`:

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

**步骤 2: 创建 SegmentItem 组件**

创建 `src/components/Workspace/SegmentItem.tsx`:

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

**步骤 3: 创建 TranscriptPanel**

创建 `src/components/Workspace/TranscriptPanel.tsx`:

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

**步骤 4: 创建 Workspace 容器**

创建 `src/components/Workspace/index.tsx`:

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

**步骤 5: 创建 AudioPlayer**

创建 `src/components/ControlBar/AudioPlayer.tsx`:

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

**步骤 6: 创建 ActionButtons**

创建 `src/components/ControlBar/ActionButtons.tsx`:

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

**步骤 7: 创建 ControlBar**

创建 `src/components/ControlBar/index.tsx`:

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

**步骤 8: 创建 StatusBar**

创建 `src/components/StatusBar/index.tsx`:

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

**步骤 9: 在 App.tsx 中整合所有组件**

替换 `src/App.tsx`:

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

**步骤 10: 验证完整 UI 渲染正常**

```bash
npm run tauri dev
```

预期结果: 应用显示侧边栏、带空状态的工作区、音频播放器控件、上传按钮和状态栏。

**步骤 11: 提交**

```bash
git add src/
git commit -m "feat: implement Workspace, TranscriptPanel, AudioPlayer, ControlBar, and StatusBar"
```

---

### 任务 8: 端到端集成测试

**目标:** 验证完整流程: 上传 WAV -> Whisper 转录 -> 显示文本 -> 点击时间戳跳转播放。

**步骤 1: 启动 ASR 服务和 Tauri 应用**

终端 1:
```bash
cd /home/yuchen_wu_trusone_com/projects/openMeet
source .venv/bin/activate
python -m asr_service.main
```

终端 2:
```bash
cd /home/yuchen_wu_trusone_com/projects/openMeet
npm run tauri dev
```

**步骤 2: 手动 E2E 测试清单**

- [ ] 在侧边栏点击 "New" -> 创建一个项目
- [ ] 点击 "Upload" -> 选择一个 WAV/MP3 文件
- [ ] 状态栏显示 "RUNNING" 且进度条在推进
- [ ] 转录片段随转录进度实时出现
- [ ] 完成后状态栏显示 "COMPLETED"
- [ ] 音频播放器显示正确的时长
- [ ] 点击播放按钮 -> 音频播放
- [ ] 点击转录文本中的时间戳 -> 音频跳转到对应位置
- [ ] 进度滑块跟踪音频位置

**步骤 3: 修复 E2E 测试中发现的问题**

解决手动测试中发现的所有集成问题。

**步骤 4: 提交修复**

```bash
git add -A
git commit -m "fix: address integration issues from E2E testing"
```

---

## 阶段 2: 多模型 + 实时录制 + 说话人分离 (第 3-4 周)

> 详细实施计划将在阶段 2 开始时创建。

### 任务 9: 集成 Qwen3-ASR 引擎
- 涉及文件: `asr_service/engines/qwen3_engine.py`, 测试文件
- 安装 `qwen-asr` 包，按照 ASREngine 协议实现 QwenEngine 类
- 处理模型下载和 VRAM 管理

### 任务 10: 集成 FunASR Paraformer 引擎
- 涉及文件: `asr_service/engines/paraformer_engine.py`, 测试文件
- 复用 `meeting/models/` 目录中的模型文件
- 实现 ParaformerEngine 类

### 任务 11: 引擎选择器 UI
- 涉及文件: `src/components/HeaderBar/EngineSelector.tsx`, `ModelSizeSelector.tsx`, `LanguageSelector.tsx`
- 下拉菜单切换 Whisper/Qwen3/Paraformer
- 根据语言选择自动推荐引擎

### 任务 12: 实时音频采集 (Rust)
- 涉及文件: `src-tauri/src/utils/audio_capture.rs`
- 使用 `cpal` crate 进行麦克风采集
- 每 300ms 通过 WebSocket 向 Python 服务发送 PCM 数据块

### 任务 13: WebSocket 流式转录
- 涉及文件: `asr_service/routers/stream.py`, 前端 WebSocket 客户端
- 实时 VAD + 流式 ASR
- 文本到达即显示

### 任务 14: 录制控件 (开始/暂停/恢复/停止)
- 涉及文件: `src/components/ControlBar/RecordButton.tsx`
- 在前端实现完整的录制状态机
- 对接 job 暂停/恢复/取消 API

### 任务 15: 说话人分离 (双引擎: CAMPPlus + pyannote)
- 涉及文件: `asr_service/processors/diarization/campplus.py`, `pyannote.py`, `factory.py`
- 语言自适应选择
- SpeakerBadge 组件支持重命名

### 任务 16: 语言自适应后处理
- 涉及文件: `asr_service/processors/factory.py`, `vad/fsmn_vad.py`, `punctuation/ct_transformer.py`
- 中文路径使用 FSMN-VAD + CT-Transformer
- 通用路径使用 Silero-VAD

### 任务 17: ITN 集成
- 涉及文件: `asr_service/processors/itn.py`
- 中文 ITN 使用 WeTextProcessing
- 包含数字/日期/货币/电话号码模式的单元测试

### 任务 18: 模型下载管理器 UI
- 涉及文件: `src/components/Settings/ModelManager.tsx`
- 显示可用/已安装的模型
- 下载进度、删除模型

---

## 阶段 3: 智能会议纪要 + 自动管线 (第 5-6 周)

> 详细实施计划将在阶段 3 开始时创建。

### 任务 19: Ollama 集成
### 任务 20: 会议摘要提示词模板
### 任务 21: PostProcessingPipeline (自动触发)
### 任务 22: SummaryPanel (流式显示)
### 任务 23: 管线状态指示器
### 任务 24: 摘要编辑器 (Markdown)
### 任务 25: 导出 Markdown
### 任务 26: 导出 Word (python-docx)
### 任务 27: 导出 PDF
### 任务 28: 设置对话框

---

## 阶段 4: 商业 API + 产品化 (第 7-8 周)

> 详细实施计划将在阶段 4 开始时创建。

### 任务 29: OpenAI Whisper API 适配器
### 任务 30: 阿里云 ASR API 适配器
### 任务 31: API 密钥管理 UI
### 任务 32: 自动降级策略
### 任务 33: 系统音频采集
### 任务 34: 全文搜索
### 任务 35: 应用签名与打包
### 任务 36: 自动更新机制
### 任务 37: 首次运行引导
### 任务 38: 性能优化
### 任务 39: 错误处理与细节打磨
### 任务 40: 构建安装包与发布

---

## 附录: 常用命令参考

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
