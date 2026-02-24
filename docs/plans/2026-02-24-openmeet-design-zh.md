# OpenMeet - AI智能会议速记工具 设计文档

> 本文件为 `2026-02-24-openmeet-design.md` 的中文版本

> 日期：2026-02-24
> 状态：已批准
> 目标：本地优先、多模型、多语言 AI 会议速记桌面应用

---

## 1. 产品概述

### 1.1 愿景

一款本地优先、注重隐私的 AI 会议速记工具，支持多模型切换。对标 Notion AI Notes 和飞书会议纪要。

### 1.2 核心功能（MVP）

- **双输入模式**：文件上传（mp3/wav/m4a/mp4）+ 实时麦克风录音
- **多引擎 ASR**：Whisper（英文最佳）、Qwen3-ASR（方言+噪声鲁棒）、Paraformer（中文最快）
- **智能纪要生成**：通过本地 LLM（Ollama）生成议题、结论、待办事项、讨论摘要
- **说话人分离**：区分说话人（Speaker A/B），支持重命名
- **时间戳+回放**：点击时间戳跳转音频，同步高亮
- **状态控制**：暂停 / 继续 / 取消，支持断点恢复
- **自动流水线**：转录完成 → 自动分离 → ITN → 标点 → 摘要
- **编辑与导出**：在线编辑转录/摘要，导出 Markdown / Word / PDF

### 1.3 后续功能（Post-MVP）

- 商业 API 集成（OpenAI Whisper API、阿里云 ASR）
- 自动降级策略（GPU 不足 → 小模型 → 云端 API）
- 云 API 的费用追踪与配额管理
- 实时系统音频采集（WASAPI / CoreAudio）
- 关键词/热词自定义
- 会议模板（站会 / 复盘 / 头脑风暴）
- 多语言实时翻译

### 1.4 非功能性需求

- **本地优先**：默认所有处理在用户本机完成，不上传数据
- **易用性**：图形界面操作，无需命令行
- **跨平台**：Windows + macOS
- **性能**：1 小时音频在消费级 GPU（6GB+ 显存）上 5-10 分钟处理完成

---

## 2. 技术栈

| 层级 | 技术 | 选型理由 |
|-------|-----------|-----------|
| 桌面框架 | **Tauri 2.x** | 体积小（约10MB），高性能，已被 Vibe（5.3k stars）和 Meetily（9.9k stars）验证 |
| 前端 | **React 19 + TypeScript** | 生态丰富，可复用 meeting 项目的模式 |
| UI 组件库 | **Ant Design 5** / shadcn/ui | 成熟的组件库 |
| 状态管理 | **Zustand** | 轻量，TypeScript 友好 |
| 构建工具 | **Vite** | 快速 HMR，Tauri 集成良好 |
| 后端核心 | **Rust (Tauri)** | 文件 I/O、进程管理、SQLite、IPC 路由 |
| ASR 服务 | **Python FastAPI**（Sidecar） | 统一支持所有 ASR 引擎 |
| ASR 引擎 | **faster-whisper** + **Qwen3-ASR** + **FunASR Paraformer** | 语言覆盖最佳 |
| 说话人分离 | **CAMPPlus**（中文）+ **pyannote-audio**（多语言） | 按语言自适应 |
| VAD | **FSMN-VAD**（中文）+ **Silero-VAD**（通用） | 按语言自适应 |
| 标点恢复 | **CT-Transformer**（中文） | 中文标点准确率最高 |
| ITN | **WeTextProcessing** | 中文逆文本正则化 |
| LLM 摘要 | **Ollama** | 一键部署 Qwen2.5/Mistral/Llama |
| 数据库 | **SQLite**（via Tauri） | 本地优先，零配置 |
| 音频处理 | **ffmpeg**（格式转换）+ **cpal**（Rust 音频采集） | 跨平台音频 |

---

## 3. 架构设计

### 3.1 高层架构（混合模式）

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

### 3.2 双输入数据流

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

### 3.3 任务状态机

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

## 4. ASR 引擎策略

### 4.1 三大引擎

| 引擎 | 最适场景 | 速度 | 显存需求 | 备注 |
|--------|----------|-------|------|-------|
| **faster-whisper** | 英文、多语言 | 4x Whisper | 约4GB（medium） | 99 种语言，CTranslate2 优化 |
| **Qwen3-ASR** | 中文方言、噪声环境 | 中等 | 约3GB（0.6B）、约6GB（1.7B） | 22 种方言，噪声鲁棒性最佳 |
| **Paraformer** (FunASR) | 标准普通话 | **最快**（约10x 实时） | 约2GB | 非自回归，资源消耗最低 |

### 4.2 自动推荐逻辑

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

### 4.3 按语言自适应的后处理流水线

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

## 5. 后端：Python ASR 服务

### 5.1 目录结构

```
asr_service/
├── main.py                    # FastAPI 入口，uvicorn 启动
├── config.py                  # 模型路径、GPU 配置、降级策略
├── routers/
│   ├── jobs.py                # 任务 CRUD + 状态控制（暂停/继续/取消）
│   ├── stream.py              # WebSocket 实时音频流
│   └── health.py              # GET /health
├── engines/
│   ├── base.py                # ASREngine Protocol + 数据模型
│   ├── whisper_engine.py      # faster-whisper 封装
│   ├── qwen3_engine.py        # Qwen3-ASR 封装
│   ├── paraformer_engine.py   # FunASR Paraformer 封装
│   └── openai_api_engine.py   # 商业 API 适配器（Phase 4）
├── processors/
│   ├── factory.py             # 按语言自适应的处理器选择
│   ├── vad/
│   │   ├── fsmn_vad.py        # FSMN-VAD（中文优化）
│   │   └── silero_vad.py      # Silero-VAD（通用）
│   ├── punctuation/
│   │   ├── ct_transformer.py  # CT-Transformer（中文）
│   │   └── noop.py            # 空操作，用于自带标点的引擎
│   ├── diarization/
│   │   ├── campplus.py        # CAMPPlus（中文，轻量）
│   │   └── pyannote.py        # pyannote-audio（多语言）
│   ├── itn.py                 # WeTextProcessing ITN
│   └── timestamp_aligner.py   # 时间戳对齐（WhisperX 方案）
├── pipeline.py                # 自动后处理流水线编排器
├── job_manager.py             # 任务生命周期 + 状态机
├── models/
│   ├── job.py                 # Job/Segment/Summary 数据模型
│   └── manager.py             # 模型下载、缓存、GPU 管理
└── utils/
    ├── gpu_monitor.py         # GPU 显存监控，OOM 预防
    └── audio_utils.py         # 音频格式工具
```

### 5.2 API 端点

```
POST   /jobs                    → 创建转录任务
GET    /jobs/{id}               → 获取任务状态 + 进度
POST   /jobs/{id}/start         → 启动转录（文件模式）
PUT    /jobs/{id}/pause         → 暂停转录
PUT    /jobs/{id}/resume        → 从断点恢复
PUT    /jobs/{id}/cancel        → 取消并清理
WS     /ws/jobs/{id}/stream     → 实时音频流（流式模式）
GET    /jobs/{id}/result        → 获取转录结果
GET    /health                  → 服务健康检查
GET    /engines                 → 列出可用引擎和模型
POST   /engines/{name}/download → 下载模型
```

### 5.3 ASR 引擎协议

```python
class ASREngine(Protocol):
    async def transcribe(self, audio: AudioInput) -> TranscriptionResult: ...
    async def transcribe_stream(self, audio_chunks: AsyncIterator[bytes]) -> AsyncIterator[Segment]: ...
    async def get_capabilities(self) -> EngineCapabilities: ...
    async def load_model(self, model_size: str) -> None: ...
    async def unload_model(self) -> None: ...
```

### 5.4 后处理流水线

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

## 6. 后端：Tauri Rust 层

### 6.1 目录结构

```
src-tauri/src/
├── main.rs                    # Tauri 入口
├── commands/
│   ├── audio.rs               # 音频文件处理（ffmpeg 调用）
│   ├── transcription.rs       # 转录流程编排
│   ├── project.rs             # 项目 CRUD（SQLite）
│   └── export.rs              # 导出 Markdown / Word / PDF
├── services/
│   ├── sidecar_manager.rs     # Python 进程生命周期管理
│   ├── ollama_client.rs       # Ollama HTTP 客户端
│   └── model_registry.rs      # 已安装模型注册表
├── db/
│   └── schema.rs              # SQLite 表定义
└── utils/
    ├── hardware_detect.rs     # GPU 检测、模型大小推荐
    └── audio_capture.rs       # cpal 麦克风采集
```

### 6.2 数据库 Schema（SQLite）

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

## 7. 前端：React 组件架构

### 7.1 页面布局

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

### 7.2 组件树

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

### 7.3 核心状态（Zustand）

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

## 8. 开发阶段

### 第一阶段：基础转录工具（第 1-2 周）

**目标：** 可运行的桌面应用，上传音频 → Whisper 转录 → 显示文本

```
第 1 周：项目骨架
T1.1  初始化 Tauri + React + TypeScript 项目
T1.2  搭建 Python ASR Service 骨架（FastAPI + uvicorn）
T1.3  实现 Tauri Sidecar 管理（启动/停止 Python 进程）
T1.4  集成 faster-whisper 引擎（whisper_engine.py）
T1.5  实现音频预处理（ffmpeg 格式转换，重采样至 16kHz）
T1.6  实现 POST /jobs + /jobs/{id}/start 基础转录 API
T1.7  Tauri Rust：音频文件选择器 + 调用 ASR Service 的 IPC

第 2 周：基础 UI
T2.1  实现 Sidebar + ProjectList（SQLite CRUD）
T2.2  实现 UploadButton + 文件选择对话框
T2.3  实现 TranscriptPanel + SegmentList（基础文本展示）
T2.4  实现 JobProgress 进度条（SSE 进度接收）
T2.5  实现 AudioPlayer（基础 播放/暂停/进度条）
T2.6  时间戳点击跳转
T2.7  端到端测试：上传 WAV → Whisper 转录 → 显示文本 → 播放音频
```

**交付物：** 上传音频、Whisper 转录、显示带时间戳文本、点击跳转播放

### 第二阶段：多模型 + 实时录音 + 说话人分离（第 3-4 周）

**目标：** 集成 Qwen3-ASR + Paraformer，实时录音，说话人分离

```
第 3 周：多引擎 + 录音
T3.1  集成 Qwen3-ASR 引擎（qwen3_engine.py）
T3.2  实现 EngineSelector + ModelSizeSelector 组件
T3.3  实现 Rust 音频采集（cpal crate，麦克风输入）
T3.4  实现 WebSocket 流式转录（WS /ws/jobs/{id}/stream）
T3.5  实现 RecordButton + 录音交互（开始/暂停/停止）
T3.6  实现任务状态机（暂停/继续/取消 API + 前端同步）
T3.7  实时文本流式展示（自动追加 + 自动滚动）
T3.8  集成 FunASR Paraformer 引擎（paraformer_engine.py）

第 4 周：说话人分离 + 编辑 + 后处理
T4.1   实现双分离方案：CAMPPlus（中文）+ pyannote（多语言）
T4.2   实现 SpeakerBadge 组件（彩色标记，点击重命名）
T4.3   实现转录文本编辑（双击编辑，失焦自动保存）
T4.4   实现 LanguageSelector（zh/en/ja/ko/自动检测）
T4.5   GPU 显存管理：模型加载/卸载/自动降级
T4.6   模型下载管理器 UI（进度、已安装模型列表）
T4.7   集成测试：中文音频 → Qwen3-ASR → 分离 → 编辑
T4.8   集成 WeTextProcessing / FunASR ITN 模块
T4.9   Whisper 中文 ITN 单元测试（数字/日期/货币/电话）
T4.10  实现 ProcessorFactory（按语言自适应选择处理器）
T4.11  集成 FSMN-VAD + CT-Transformer（从 meeting 项目迁移模型）
```

**交付物：** 切换 Whisper/Qwen3/Paraformer，实时录音支持暂停/继续/取消，说话人分离，可编辑文本，按语言自适应的后处理（ITN + 标点 + VAD）

### 第三阶段：智能纪要 + 自动流水线（第 5-6 周）

**目标：** 转录完成后自动生成结构化会议纪要，支持导出

```
第 5 周：纪要生成
T5.1  Ollama 集成（检测/启动/模型管理）
T5.2  设计纪要 Prompt 模板（中英文双语）
T5.3  实现 PostProcessingPipeline（转录完成后自动触发）
T5.4  实现 SummaryPanel（流式展示 Ollama 输出）
T5.5  实现 PipelineSteps 状态指示器
T5.6  摘要 Markdown 编辑器（SummaryEditor）
T5.7  摘要"重新生成"功能（切换 LLM 模型 / 调整 Prompt）

第 6 周：导出 + 打磨
T6.1  导出 Markdown 格式（转录 + 摘要合并）
T6.2  导出 Word 格式（python-docx）
T6.3  导出 PDF 格式（weasyprint 或 docx-to-pdf）
T6.4  ExportButton + 格式下拉菜单
T6.5  SettingsDialog（GeneralTab + EngineTab + OllamaTab）
T6.6  中文标点恢复后处理
T6.7  端到端测试：录音 → Qwen3 转录 → 分离 → 自动摘要 → 导出 Word
```

**交付物：** 完整的转录 → 分离 → 摘要自动流水线，Markdown/Word/PDF 导出，设置面板

### 第四阶段：商业 API + 产品化（第 7-8 周）

**目标：** 商业 API 集成，产品打磨，打包发布

```
第 7 周：商业 API + 高级功能
T7.1  实现 OpenAI Whisper API 适配器（openai_api_engine.py）
T7.2  实现阿里云 ASR API 适配器
T7.3  APITab 设置（密钥管理、用量统计、费用告警）
T7.4  自动降级：GPU 不足 → 小模型 → 云端 API
T7.5  模式指示器（本地 / 云端 + 预估费用）
T7.6  系统音频采集（Windows WASAPI / macOS CoreAudio）
T7.7  搜索：转录全文搜索 + 高亮

第 8 周：打包 & 发布
T8.1  Tauri 应用签名（Windows 代码签名 + macOS 公证）
T8.2  自动更新机制（Tauri updater）
T8.3  应用图标 + 启动画面设计
T8.4  首次运行引导（模型下载向导）
T8.5  性能优化：长列表虚拟化 + 大文件处理
T8.6  错误处理 & 用户反馈（全局错误边界 + Toast 通知）
T8.7  构建 Windows/macOS 安装包 + GitHub Release
```

**交付物：** 商业 API 兜底，自动降级，签名应用包，可分发安装程序

### 第五阶段：高级功能（Post-MVP）

```
T-post.1  系统音频 + 麦克风双通道混合录音
T-post.2  关键词/热词自定义（领域专业术语优化）
T-post.3  多语言实时翻译（转录 + 翻译）
T-post.4  会议模板（站会/复盘/头脑风暴，配置不同 Prompt）
T-post.5  团队协作：导出到 Notion/飞书/语雀
T-post.6  语音情感分析（正面/负面/中性标注）
T-post.7  macOS/Windows 系统托盘常驻录音
```

---

## 9. 关键交互

| 交互 | 行为 |
|-------------|----------|
| 点击时间戳 | 音频播放器跳转到对应位置并开始播放 |
| 点击说话人标签 | 弹出重命名输入框，批量替换所有同名实例 |
| 双击转录文本 | 进入编辑模式，失焦自动保存 |
| 拖动分隔条 | 调整左右面板比例 |
| 转录进行中 | 新片段自动滚动到底部，已有内容不跳动 |
| 自动后处理 | 状态栏显示步骤进度：转录 → 分离 → 摘要 |
| 录音暂停 | 录音按钮脉冲动画停止，显示已录制时长 |
| 转录完成 | 自动触发：ITN → 标点 → 说话人分离 → 摘要 |

---

## 10. 技术风险与应对措施

| 风险 | 影响 | 应对措施 |
|------|--------|-----------|
| Qwen3-ASR flash-attn 编译问题 | 阻塞第二阶段 | 提供不依赖 flash-attn 的后备方案，使用 sdpa attention |
| pyannote 需要 HuggingFace Token | 用户体验差 | 首次运行配置引导，本地缓存模型；中文优先使用 CAMPPlus |
| GPU 显存 OOM（多模型同时加载） | 应用崩溃 | 单模型加载策略 + gpu_monitor + 自动卸载空闲模型 |
| Python Sidecar 启动慢（约3-5秒） | 首次打开卡顿 | 启动画面 + 延迟加载模型（首次使用时加载） |
| Tauri 系统音频采集的跨平台问题 | 第四阶段延期 | MVP 仅支持麦克风，系统音频采集放到 Post-MVP |
| 长音频（2小时+）内存溢出 | 处理失败 | 分块处理 + 流式写入结果 + 内存上限控制 |
| Ollama 未安装 / 模型未下载 | 摘要不可用 | 检测 Ollama 状态 + 一键安装引导 + 降级为无摘要模式 |
| FunASR 依赖树庞大 | 安装复杂 | 隔离为可选依赖：`pip install openmeet[funasr]` |

---

## 11. 参考项目

| 项目 | Stars | 可借鉴之处 |
|---------|-------|---------------|
| [Meetily](https://github.com/Zackriya-Solutions/meeting-minutes) | 约9.9k | Tauri 架构、Ollama 集成、说话人分离 UX |
| [Vibe](https://github.com/thewh1teagle/vibe) | 约5.3k | Tauri + whisper.cpp 集成、导出格式、GPU 加速 |
| [Buzz](https://github.com/chidiwilliams/buzz) | 约17.8k | 多引擎切换设计、实时录音 |
| [WhisperX](https://github.com/m-bain/whisperX) | 约20.2k | 词级时间戳、pyannote 说话人分离集成 |
| [faster-whisper](https://github.com/SYSTRAN/faster-whisper) | 约21k | CTranslate2 优化推理 |
| [Qwen3-ASR](https://github.com/QwenLM/Qwen3-ASR) | 官方 | 方言支持、噪声鲁棒性 |
| [meeting (cloned)](./meeting/) | - | FunASR 集成、React Hooks 模式、WebSocket 实时通信 |
| [Scriberr](https://github.com/rishikanthc/Scriberr) | 约1.4k | Go+Svelte 自托管架构、REST API 设计 |

---

## 12. Meeting 项目复用评估

### 可复用

- React 前端 Hook 模式（8 个自定义 Hooks）
- WebSocket 实时通信方案
- 说话人分离 UI/UX 设计
- 导出功能（TXT/JSON/DOCX）
- FunASR 模型文件（Paraformer、FSMN-VAD、CT-Transformer、CAMPPlus）

### 不可复用

- 后端绑定 FunASR（无适配器模式）
- 纯 Web 应用架构（非桌面应用）
- 硬编码路径，零测试覆盖
- 无插件/适配器架构
