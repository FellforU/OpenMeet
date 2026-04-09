<div align="center">

# OpenMeet

**本地优先的 AI 会议转录工具 | Local-first AI Meeting Transcription Tool**

[![Version](https://img.shields.io/badge/version-0.1.0-blue.svg)](https://github.com/FellforU/OpenMeet/releases)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey.svg)]()

[中文](#中文) | [English](#english)

<!-- TODO: 添加截图 -->
<!-- ![OpenMeet Screenshot](docs/assets/screenshot.png) -->

</div>

---

# 中文

## 简介

OpenMeet 是一款隐私优先的 AI 会议转录桌面应用。所有语音识别和会议纪要生成均在本地完成，无需上传任何数据。支持文件上传和实时录音两种输入方式，内置多引擎语音识别、说话人分离、智能会议纪要等功能。

## 核心功能

- **多引擎语音识别** — Whisper（英语最佳）、Qwen3-ASR（方言+噪声鲁棒）、Paraformer（中文最快）
- **云端 API 支持** — OpenAI Whisper API、阿里云 ASR（可选）
- **实时流式转写** — WebSocket 实时推送，边录边转
- **说话人分离** — CAMPPlus（中文）+ pyannote（多语言），自动标注发言人
- **智能会议纪要** — Ollama 本地 LLM 生成议题、结论、待办事项
- **时间戳定位** — 点击时间戳跳转音频播放，同步高亮
- **流程控制** — 暂停/继续/取消，断点恢复
- **自动处理管线** — 转录 → 分离 → ITN → 标点 → 纪要，全自动
- **多格式导出** — Markdown / JSON / TXT
- **项目管理** — 文件夹分组，多会议管理
- **中英双语界面** — 完整的国际化支持

## 技术栈

| 层级 | 技术 |
|------|------|
| 桌面框架 | Tauri 2.x (Rust) |
| 前端 | React 19 + TypeScript + Vite + Radix UI + TailwindCSS |
| 状态管理 | Zustand |
| ASR 后端 | Python 3.12 + FastAPI (Sidecar) |
| ASR 引擎 | faster-whisper, Qwen3-ASR, FunASR Paraformer |
| 说话人分离 | CAMPPlus + pyannote-audio |
| LLM 纪要 | Ollama (Qwen2.5 / Mistral / Llama) |
| 数据库 | SQLite |
| 音频处理 | FFmpeg + cpal |

## 架构

```
┌──────────────────────────────────────┐
│  Tauri 桌面应用                        │
│  ┌────────────┐  ┌────────────────┐  │
│  │ React UI   │  │ Rust Core      │  │
│  │ • 播放器    │  │ ├ IPC 路由     │  │
│  │ • 编辑器    │  │ ├ 文件管理     │  │
│  │ • 导出      │  │ ├ 进程管理     │  │
│  │ • 设置      │  │ └ SQLite       │  │
│  └────────────┘  └───────┬────────┘  │
│                          │            │
│          ┌───────────────┘            │
│          ▼                            │
│  ┌────────────────┐                  │
│  │ Python ASR     │ ◄── Sidecar     │
│  │ (FastAPI:18090)│                  │
│  │ ├ 语音识别     │                  │
│  │ ├ 说话人分离   │                  │
│  │ ├ VAD/标点/ITN │                  │
│  │ └ WebSocket流  │                  │
│  └────────────────┘                  │
│          │                            │
│          ▼                            │
│  ┌────────────────┐                  │
│  │ Ollama LLM     │ ◄── 会议纪要    │
│  │ (本地推理)      │                  │
│  └────────────────┘                  │
└──────────────────────────────────────┘
```

## 系统要求

| 配置 | 最低要求 | 推荐配置 |
|------|---------|---------|
| CPU | 4 核 | 8 核+ |
| 内存 | 8 GB | 16 GB+ |
| 硬盘 | 10 GB | 30 GB+（含模型）|
| GPU | 无（CPU 模式可用）| NVIDIA 4GB+ VRAM |

### 软件依赖

| 软件 | 版本 | 用途 |
|------|------|------|
| Python | 3.10 - 3.12 | ASR 服务 |
| Node.js | 18+ | 前端构建 |
| Rust | 1.70+ | Tauri 框架 |
| FFmpeg | 4.0+ | 音频转换 |

## 安装

### 下载安装包

前往 [Releases](https://github.com/FellforU/OpenMeet/releases) 下载对应平台的安装包：

| 平台 | 文件 |
|------|------|
| Windows | `OpenMeet_x.x.x_x64-setup.exe` |
| macOS | `OpenMeet_x.x.x_aarch64.dmg` |
| Linux | `OpenMeet_x.x.x_amd64.AppImage` |

### 从源码构建

```bash
# 1. 克隆项目
git clone https://github.com/FellforU/OpenMeet.git
cd OpenMeet

# 2. 安装 Python 环境
python3 -m venv .venv
source .venv/bin/activate          # Linux/macOS
# .venv\Scripts\activate           # Windows
pip install -r asr_service/requirements.txt

# 3. 安装前端依赖
npm install

# 4. 启动开发模式
# 终端 1: ASR 服务
source .venv/bin/activate
python -m asr_service.main

# 终端 2: Tauri 桌面应用
npm run tauri dev
```

### 生产构建

```bash
npm run tauri build
```

构建产物在 `src-tauri/target/release/bundle/` 目录下。

## 开发指南

### 目录结构

```
OpenMeet/
├── asr_service/          # Python ASR 后端 (FastAPI)
│   ├── engines/          # ASR 引擎 (Whisper, Qwen3, Paraformer, OpenAI, Alibaba)
│   ├── processors/       # 处理管线 (VAD, 分离, 标点, ITN)
│   ├── services/         # 后处理, Ollama 集成
│   ├── routers/          # API 路由
│   └── main.py           # 入口
├── src/                  # React 前端
│   ├── components/       # UI 组件
│   ├── stores/           # Zustand 状态管理
│   ├── services/         # API 客户端
│   └── i18n/             # 国际化
├── src-tauri/            # Tauri Rust 后端
│   └── src/              # IPC, 音频采集, 进程管理
├── tests/                # Python 测试
└── docs/                 # 设计文档与指南
```

### 常用命令

```bash
# ASR 服务
source .venv/bin/activate
python -m asr_service.main                    # 启动服务
python -m pytest tests/ -v                    # 运行测试
python -m pytest tests/ --cov=asr_service     # 覆盖率

# 前端
npm run dev                                   # Vite 开发服务器
npm run build                                 # 构建前端

# Tauri
npm run tauri dev                             # 开发模式
npm run tauri build                           # 生产构建

# Ollama
ollama serve                                  # 启动 Ollama
ollama pull qwen2.5:7b                        # 下载模型
```

### 平台依赖安装

<details>
<summary>Linux (Ubuntu/Debian)</summary>

```bash
sudo apt update
sudo apt install -y \
    build-essential \
    libwebkit2gtk-4.1-dev \
    libssl-dev \
    libayatana-appindicator3-dev \
    librsvg2-dev \
    libasound2-dev \
    ffmpeg \
    pkg-config
```

</details>

<details>
<summary>macOS</summary>

```bash
brew install ffmpeg
xcode-select --install
```

</details>

<details>
<summary>Windows</summary>

```powershell
# 安装 Visual Studio Build Tools
# https://visualstudio.microsoft.com/visual-cpp-build-tools/
# 选择「使用 C++ 的桌面开发」

# 安装 FFmpeg
winget install Gyan.FFmpeg
```

</details>

## 路线图

- [x] 多引擎语音识别 (Whisper / Qwen3 / Paraformer)
- [x] 云端 API 支持 (OpenAI / 阿里云)
- [x] 实时 WebSocket 流式转写
- [x] 说话人分离
- [x] Ollama 智能会议纪要
- [x] 项目文件夹管理
- [x] 中英双语界面
- [ ] 音色库持久化与跨会议说话人匹配
- [ ] 账号体系
- [ ] Windows 代码签名
- [ ] 系统音频捕获 (WASAPI / CoreAudio)
- [ ] 会议模板 (站会 / 评审 / 头脑风暴)
- [ ] 多语言实时翻译

## 贡献指南

欢迎提交 Issue 和 Pull Request！

1. Fork 本仓库
2. 创建功能分支：`git checkout -b feat/my-feature`
3. 提交更改：`git commit -m "feat: add my feature"`
4. 推送分支：`git push origin feat/my-feature`
5. 创建 Pull Request

### 提交规范

使用 [Conventional Commits](https://www.conventionalcommits.org/) 格式：

- `feat`: 新功能
- `fix`: 修复 Bug
- `refactor`: 重构
- `docs`: 文档
- `test`: 测试
- `chore`: 杂项
- `perf`: 性能优化

## 许可证

[MIT License](LICENSE)

---

# English

## Introduction

OpenMeet is a privacy-first AI meeting transcription desktop app. All speech recognition and meeting minutes generation run locally — no data leaves your machine. Supports both file upload and real-time recording, with multi-engine ASR, speaker diarization, and intelligent meeting minutes.

## Key Features

- **Multi-engine ASR** — Whisper (best for English), Qwen3-ASR (dialect + noise robust), Paraformer (fastest for Chinese)
- **Cloud API support** — OpenAI Whisper API, Alibaba Cloud ASR (optional)
- **Real-time streaming** — WebSocket live transcription
- **Speaker diarization** — CAMPPlus (Chinese) + pyannote (multilingual)
- **Smart meeting minutes** — Ollama local LLM generates topics, conclusions, action items
- **Timestamp navigation** — Click timestamps to seek audio with synchronized highlighting
- **Flow control** — Pause / Resume / Cancel with checkpoint recovery
- **Auto pipeline** — Transcription → Diarization → ITN → Punctuation → Summary
- **Multi-format export** — Markdown / JSON / TXT
- **Project management** — Folder grouping, multi-meeting organization
- **Bilingual UI** — Full Chinese/English internationalization

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Desktop | Tauri 2.x (Rust) |
| Frontend | React 19 + TypeScript + Vite + Radix UI + TailwindCSS |
| State | Zustand |
| ASR Backend | Python 3.12 + FastAPI (Sidecar) |
| ASR Engines | faster-whisper, Qwen3-ASR, FunASR Paraformer |
| Diarization | CAMPPlus + pyannote-audio |
| LLM Summary | Ollama (Qwen2.5 / Mistral / Llama) |
| Database | SQLite |
| Audio | FFmpeg + cpal |

## Architecture

```
┌──────────────────────────────────────┐
│  Tauri Desktop App                    │
│  ┌────────────┐  ┌────────────────┐  │
│  │ React UI   │  │ Rust Core      │  │
│  │ • Player   │  │ ├ IPC Router   │  │
│  │ • Editor   │  │ ├ File Mgmt    │  │
│  │ • Export   │  │ ├ Proc Mgmt    │  │
│  │ • Settings │  │ └ SQLite DB    │  │
│  └────────────┘  └───────┬────────┘  │
│                          │            │
│          ┌───────────────┘            │
│          ▼                            │
│  ┌────────────────┐                  │
│  │ Python ASR     │ ◄── Sidecar     │
│  │ (FastAPI:18090)│                  │
│  │ ├ ASR Engines  │                  │
│  │ ├ Diarization  │                  │
│  │ ├ VAD/Punct/ITN│                  │
│  │ └ WebSocket    │                  │
│  └────────────────┘                  │
│          │                            │
│          ▼                            │
│  ┌────────────────┐                  │
│  │ Ollama LLM     │ ◄── Summary     │
│  │ (Local Infer)  │                  │
│  └────────────────┘                  │
└──────────────────────────────────────┘
```

## System Requirements

| Spec | Minimum | Recommended |
|------|---------|-------------|
| CPU | 4 cores | 8+ cores |
| RAM | 8 GB | 16 GB+ |
| Disk | 10 GB | 30 GB+ (with models) |
| GPU | None (CPU mode) | NVIDIA 4GB+ VRAM |

### Software Dependencies

| Software | Version | Purpose |
|----------|---------|---------|
| Python | 3.10 - 3.12 | ASR service |
| Node.js | 18+ | Frontend build |
| Rust | 1.70+ | Tauri framework |
| FFmpeg | 4.0+ | Audio conversion |

## Installation

### Download Installer

Go to [Releases](https://github.com/FellforU/OpenMeet/releases) and download for your platform:

| Platform | File |
|----------|------|
| Windows | `OpenMeet_x.x.x_x64-setup.exe` |
| macOS | `OpenMeet_x.x.x_aarch64.dmg` |
| Linux | `OpenMeet_x.x.x_amd64.AppImage` |

### Build from Source

```bash
# 1. Clone the repo
git clone https://github.com/FellforU/OpenMeet.git
cd OpenMeet

# 2. Set up Python environment
python3 -m venv .venv
source .venv/bin/activate          # Linux/macOS
# .venv\Scripts\activate           # Windows
pip install -r asr_service/requirements.txt

# 3. Install frontend dependencies
npm install

# 4. Start development mode
# Terminal 1: ASR service
source .venv/bin/activate
python -m asr_service.main

# Terminal 2: Tauri desktop app
npm run tauri dev
```

### Production Build

```bash
npm run tauri build
```

Build artifacts are in `src-tauri/target/release/bundle/`.

## Development Guide

### Directory Structure

```
OpenMeet/
├── asr_service/          # Python ASR backend (FastAPI)
│   ├── engines/          # ASR engines (Whisper, Qwen3, Paraformer, OpenAI, Alibaba)
│   ├── processors/       # Pipeline (VAD, Diarization, Punctuation, ITN)
│   ├── services/         # Post-processing, Ollama integration
│   ├── routers/          # API routes
│   └── main.py           # Entry point
├── src/                  # React frontend
│   ├── components/       # UI components
│   ├── stores/           # Zustand state management
│   ├── services/         # API client
│   └── i18n/             # Internationalization
├── src-tauri/            # Tauri Rust backend
│   └── src/              # IPC, audio capture, process management
├── tests/                # Python tests
└── docs/                 # Design docs and guides
```

### Common Commands

```bash
# ASR Service
source .venv/bin/activate
python -m asr_service.main                    # Start service
python -m pytest tests/ -v                    # Run tests
python -m pytest tests/ --cov=asr_service     # Coverage

# Frontend
npm run dev                                   # Vite dev server
npm run build                                 # Build frontend

# Tauri
npm run tauri dev                             # Dev mode
npm run tauri build                           # Production build

# Ollama
ollama serve                                  # Start Ollama
ollama pull qwen2.5:7b                        # Download model
```

### Platform Dependencies

<details>
<summary>Linux (Ubuntu/Debian)</summary>

```bash
sudo apt update
sudo apt install -y \
    build-essential \
    libwebkit2gtk-4.1-dev \
    libssl-dev \
    libayatana-appindicator3-dev \
    librsvg2-dev \
    libasound2-dev \
    ffmpeg \
    pkg-config
```

</details>

<details>
<summary>macOS</summary>

```bash
brew install ffmpeg
xcode-select --install
```

</details>

<details>
<summary>Windows</summary>

```powershell
# Install Visual Studio Build Tools
# https://visualstudio.microsoft.com/visual-cpp-build-tools/
# Select "Desktop development with C++"

# Install FFmpeg
winget install Gyan.FFmpeg
```

</details>

## Roadmap

- [x] Multi-engine ASR (Whisper / Qwen3 / Paraformer)
- [x] Cloud API support (OpenAI / Alibaba)
- [x] Real-time WebSocket streaming
- [x] Speaker diarization
- [x] Ollama meeting minutes
- [x] Project folder management
- [x] Bilingual UI (Chinese/English)
- [ ] Persistent voice library with cross-meeting speaker matching
- [ ] Account system
- [ ] Windows code signing
- [ ] System audio capture (WASAPI / CoreAudio)
- [ ] Meeting templates (standup / review / brainstorm)
- [ ] Multi-language real-time translation

## Contributing

Issues and Pull Requests are welcome!

1. Fork this repository
2. Create a feature branch: `git checkout -b feat/my-feature`
3. Commit your changes: `git commit -m "feat: add my feature"`
4. Push the branch: `git push origin feat/my-feature`
5. Create a Pull Request

### Commit Convention

Follow [Conventional Commits](https://www.conventionalcommits.org/):

- `feat`: New feature
- `fix`: Bug fix
- `refactor`: Code refactoring
- `docs`: Documentation
- `test`: Tests
- `chore`: Maintenance
- `perf`: Performance

## License

[MIT License](LICENSE)
