# OpenMeet 安装部署与运行指南

> **版本**: 0.1.0
> **最后更新**: 2026-02-24
> **适用平台**: Windows / macOS / Linux

---

## 目录

- [项目简介](#项目简介)
- [系统要求](#系统要求)
- [快速开始](#快速开始)
- [详细安装步骤](#详细安装步骤)
  - [1. 基础环境准备](#1-基础环境准备)
  - [2. 克隆项目](#2-克隆项目)
  - [3. Python ASR 服务安装](#3-python-asr-服务安装)
  - [4. 前端与 Tauri 安装](#4-前端与-tauri-安装)
  - [5. Ollama 安装（智能会议纪要）](#5-ollama-安装智能会议纪要)
  - [6. 模型下载](#6-模型下载)
- [运行项目](#运行项目)
  - [开发模式](#开发模式)
  - [生产构建](#生产构建)
- [云端 API 配置（可选）](#云端-api-配置可选)
- [环境变量参考](#环境变量参考)
- [项目架构](#项目架构)
- [ASR 引擎选择指南](#asr-引擎选择指南)
- [常见问题排查](#常见问题排查)
- [更新升级](#更新升级)
- [卸载](#卸载)

---

## 项目简介

**OpenMeet** 是一款本地优先的 AI 会议转录工具，支持实时录音转写、多引擎语音识别、智能会议纪要生成。核心特性：

- 5 个 ASR 引擎（3 本地 + 2 云端 API）
- 实时 WebSocket 流式转写
- Ollama 本地 LLM 智能会议纪要
- 说话人分离、标点还原、文本反转录
- 全文搜索、多格式导出（Markdown/JSON/TXT）
- GPU 自动降级策略

---

## 系统要求

### 硬件要求

| 配置 | 最低要求 | 推荐配置 |
|------|---------|---------|
| **CPU** | 4 核 | 8 核+ |
| **内存** | 8 GB | 16 GB+ |
| **硬盘** | 10 GB 可用空间 | 30 GB+（含模型） |
| **GPU** | 无（CPU 模式可用） | NVIDIA 4GB+ VRAM（CUDA 加速） |
| **麦克风** | 任意录音设备 | USB 外置麦克风 |

### 软件要求

| 软件 | 版本要求 | 用途 |
|------|---------|------|
| **Python** | 3.10 - 3.12 | ASR 服务后端 |
| **Node.js** | 18+ | 前端构建 |
| **npm** | 9+ | 包管理 |
| **Rust** | 1.70+ | Tauri 桌面框架 |
| **Git** | 2.0+ | 版本控制 |
| **FFmpeg** | 4.0+ | 音频格式转换 |

### 平台专属依赖

**Linux (Ubuntu/Debian)**:
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
    pkg-config \
    curl \
    wget
```

**macOS**:
```bash
# 安装 Homebrew（如尚未安装）
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

brew install ffmpeg
# Xcode 命令行工具（Tauri 构建需要）
xcode-select --install
```

**Windows**:
```powershell
# 安装 Visual Studio Build Tools（Tauri 构建需要）
# 下载地址: https://visualstudio.microsoft.com/visual-cpp-build-tools/
# 安装时选择「使用 C++ 的桌面开发」

# 安装 FFmpeg（推荐使用 winget）
winget install Gyan.FFmpeg

# 或下载: https://www.ffmpeg.org/download.html 并添加到 PATH
```

---

## 快速开始

如果你已安装好所有基础环境，可以直接执行以下命令：

```bash
# 1. 克隆项目
git clone <repository-url> openMeet
cd openMeet

# 2. Python 环境
python3 -m venv .venv
source .venv/bin/activate          # Linux/macOS
# .venv\Scripts\activate           # Windows
pip install -r asr_service/requirements.txt

# 3. 前端依赖
npm install

# 4. 启动开发模式（需要两个终端）

# 终端 1: ASR 服务
source .venv/bin/activate
python -m asr_service.main

# 终端 2: Tauri 桌面应用
npm run tauri dev
```

---

## 详细安装步骤

### 1. 基础环境准备

#### 安装 Python

**Linux (Ubuntu/Debian)**:
```bash
sudo apt install python3.12 python3.12-venv python3-pip
```

**macOS**:
```bash
brew install python@3.12
```

**Windows**:
从 [python.org](https://www.python.org/downloads/) 下载安装，勾选「Add Python to PATH」。

#### 安装 Node.js

推荐使用 [nvm](https://github.com/nvm-sh/nvm) 管理 Node.js 版本：

```bash
# Linux / macOS
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
nvm install 20
nvm use 20

# Windows: 使用 nvm-windows
# 下载: https://github.com/coreybutler/nvm-windows/releases
```

或直接从 [nodejs.org](https://nodejs.org/) 下载 LTS 版本。

#### 安装 Rust

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source $HOME/.cargo/env
rustup update
```

Windows 用户访问 [rustup.rs](https://rustup.rs/) 下载安装程序。

验证安装：
```bash
python3 --version    # 3.10+
node --version       # 18+
npm --version        # 9+
rustc --version      # 1.70+
cargo --version
ffmpeg -version
```

### 2. 克隆项目

```bash
git clone <repository-url> openMeet
cd openMeet
```

项目目录结构：
```
openMeet/
├── asr_service/        # Python ASR 后端（FastAPI）
├── src/                # React 前端
├── src-tauri/          # Rust Tauri 桌面后端
├── tests/              # Python 测试
├── docs/               # 设计文档和实施计划
├── meeting/models/     # 预置模型文件
├── models/             # 运行时模型缓存（自动创建）
└── data/               # 数据目录（自动创建）
```

### 3. Python ASR 服务安装

#### 创建虚拟环境

```bash
python3 -m venv .venv

# 激活虚拟环境
source .venv/bin/activate          # Linux / macOS
# .venv\Scripts\activate           # Windows PowerShell
# .venv\Scripts\activate.bat       # Windows CMD
```

#### 安装依赖

```bash
pip install --upgrade pip
pip install -r asr_service/requirements.txt
```

主要依赖说明：

| 包名 | 版本 | 用途 |
|------|------|------|
| fastapi | 0.115.* | Web 框架 |
| uvicorn | 0.34.* | ASGI 服务器 |
| faster-whisper | 1.1.* | Whisper 语音识别 |
| pydantic | 2.* | 数据模型验证 |
| httpx | * | 异步 HTTP 客户端 |
| websockets | * | WebSocket 支持 |
| numpy | * | 数值计算 |

#### GPU 加速（可选但推荐）

如果你有 NVIDIA GPU 并希望加速转录，需要安装 CUDA Toolkit。

##### 检查当前状态

```bash
# 检查 GPU 驱动和支持的 CUDA 版本
nvidia-smi

# 检查 CUDA Toolkit 是否已安装
nvcc --version
```

如果 `nvidia-smi` 显示 CUDA Version（如 13.0），但 `nvcc` 命令不存在，说明只安装了驱动，需要安装 CUDA Toolkit。

##### Windows 安装 CUDA Toolkit

**1. 选择 CUDA 版本**

根据你的 GPU 驱动支持的 CUDA 版本选择：
- 驱动支持 CUDA 13.0+ → 推荐安装 CUDA 12.6（兼容性好）
- 驱动支持 CUDA 12.x → 安装 CUDA 12.1 或 12.6
- 驱动支持 CUDA 11.x → 安装 CUDA 11.8

**2. 下载 CUDA Toolkit**

访问 [NVIDIA CUDA Toolkit 下载页](https://developer.nvidia.com/cuda-downloads)

选择：
- Operating System: Windows
- Architecture: x86_64
- Version: 10/11
- Installer Type: exe (local) 推荐

或直接下载 CUDA 12.6:
```
https://developer.download.nvidia.com/compute/cuda/12.6.0/local_installers/cuda_12.6.0_560.76_windows.exe
```

**3. 安装 CUDA Toolkit**

```powershell
# 运行下载的安装程序
# 安装选项：
# - 选择「自定义安装」
# - 必选组件：
#   ✓ CUDA Toolkit
#   ✓ CUDA Runtime
#   ✓ CUDA Development
#   ✓ CUDA Documentation (可选)
# - 安装路径默认：C:\Program Files\NVIDIA GPU Computing Toolkit\CUDA\v12.6
```

**4. 配置环境变量**

安装程序通常会自动配置，手动验证：

```powershell
# 检查环境变量（PowerShell）
$env:CUDA_PATH
# 应输出: C:\Program Files\NVIDIA GPU Computing Toolkit\CUDA\v12.6

# 检查 PATH 是否包含 CUDA bin 目录
$env:PATH -split ';' | Select-String cuda
# 应包含: C:\Program Files\NVIDIA GPU Computing Toolkit\CUDA\v12.6\bin
```

如果未自动配置，手动添加：

```powershell
# 临时添加（当前会话）
$env:CUDA_PATH = "C:\Program Files\NVIDIA GPU Computing Toolkit\CUDA\v12.6"
$env:PATH += ";$env:CUDA_PATH\bin"

# 永久添加：
# 1. 右键「此电脑」→「属性」→「高级系统设置」→「环境变量」
# 2. 系统变量中新建：
#    变量名: CUDA_PATH
#    变量值: C:\Program Files\NVIDIA GPU Computing Toolkit\CUDA\v12.6
# 3. 编辑 Path 变量，添加：
#    %CUDA_PATH%\bin
#    %CUDA_PATH%\libnvvp
```

**5. 验证安装**

```powershell
# 重启 PowerShell 后验证
nvcc --version
# 应输出: Cuda compilation tools, release 12.6, V12.6.xxx

# 检查 CUDA 示例编译（可选）
cd "C:\Program Files\NVIDIA GPU Computing Toolkit\CUDA\v12.6\extras\demo_suite"
.\deviceQuery.exe
# 应显示 GPU 信息和 "Result = PASS"
```

##### Linux 安装 CUDA Toolkit

**Ubuntu/Debian**:

```bash
# 1. 添加 NVIDIA 官方源
wget https://developer.download.nvidia.com/compute/cuda/repos/ubuntu2204/x86_64/cuda-keyring_1.1-1_all.deb
sudo dpkg -i cuda-keyring_1.1-1_all.deb
sudo apt update

# 2. 安装 CUDA Toolkit（推荐 12.6）
sudo apt install cuda-toolkit-12-6

# 3. 配置环境变量
echo 'export PATH=/usr/local/cuda-12.6/bin:$PATH' >> ~/.bashrc
echo 'export LD_LIBRARY_PATH=/usr/local/cuda-12.6/lib64:$LD_LIBRARY_PATH' >> ~/.bashrc
source ~/.bashrc

# 4. 验证
nvcc --version
```

##### macOS 注意事项

macOS 不支持 NVIDIA GPU 和 CUDA。如果使用 Apple Silicon (M1/M2/M3)，PyTorch 会自动使用 Metal Performance Shaders (MPS) 加速，无需额外配置。

##### 安装 cuDNN（可选，提升性能）

cuDNN 是 CUDA 的深度学习加速库，可进一步提升性能：

**Windows**:

```powershell
# 1. 下载 cuDNN（需要 NVIDIA 账号）
# 访问: https://developer.nvidia.com/cudnn
# 选择与 CUDA 版本匹配的 cuDNN（如 cuDNN 9.x for CUDA 12.x）

# 2. 解压下载的 zip 文件

# 3. 复制文件到 CUDA 目录
# 将 cudnn-windows-x86_64-9.x.x\bin\*.dll 复制到:
#   C:\Program Files\NVIDIA GPU Computing Toolkit\CUDA\v12.6\bin\
# 将 cudnn-windows-x86_64-9.x.x\include\*.h 复制到:
#   C:\Program Files\NVIDIA GPU Computing Toolkit\CUDA\v12.6\include\
# 将 cudnn-windows-x86_64-9.x.x\lib\*.lib 复制到:
#   C:\Program Files\NVIDIA GPU Computing Toolkit\CUDA\v12.6\lib\x64\
```

**Linux**:

```bash
# 使用 apt 安装（推荐）
sudo apt install libcudnn9-cuda-12

# 或手动下载安装
# 下载: https://developer.nvidia.com/cudnn
tar -xvf cudnn-linux-x86_64-9.x.x.tgz
sudo cp cuda/include/cudnn*.h /usr/local/cuda/include
sudo cp cuda/lib64/libcudnn* /usr/local/cuda/lib64
sudo chmod a+r /usr/local/cuda/include/cudnn*.h /usr/local/cuda/lib64/libcudnn*
```

##### 验证 GPU 加速

```bash
# 激活虚拟环境
source .venv/bin/activate

# Python 中验证 CUDA
python3 -c "
import torch
print(f'CUDA available: {torch.cuda.is_available()}')
print(f'CUDA version: {torch.version.cuda}')
print(f'GPU count: {torch.cuda.device_count()}')
if torch.cuda.is_available():
    print(f'GPU name: {torch.cuda.get_device_name(0)}')
"

# 测试 faster-whisper GPU 加速
python3 -c "
from faster_whisper import WhisperModel
model = WhisperModel('tiny', device='cuda', compute_type='float16')
print('GPU 加速可用！')
"
```

如果输出 `CUDA available: True` 和 GPU 名称，说明安装成功。

##### 常见问题

**问题 1**: `nvcc --version` 显示版本，但 PyTorch 检测不到 CUDA

```bash
# 检查 PyTorch 安装的 CUDA 版本
python3 -c "import torch; print(torch.version.cuda)"

# 如果版本不匹配，重新安装 PyTorch
pip uninstall torch
# 访问 https://pytorch.org/get-started/locally/ 选择对应 CUDA 版本
pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu126
```

**问题 2**: `CUDA out of memory` 错误

```
解决方案：
1. 选择更小的模型（Whisper: large → medium → small）
2. 减小 batch_size（在 config.py 中调整）
3. 关闭其他占用 GPU 的程序
4. 使用 CPU 模式（device='cpu'）
```

**问题 3**: Windows 上 `nvcc` 命令找不到

```powershell
# 检查安装路径
dir "C:\Program Files\NVIDIA GPU Computing Toolkit\CUDA"

# 手动添加到 PATH
$env:PATH += ";C:\Program Files\NVIDIA GPU Computing Toolkit\CUDA\v12.6\bin"

# 重启 PowerShell
```

faster-whisper 和其他 ASR 引擎会自动检测 CUDA 并使用 GPU 加速，无需额外配置。

#### 验证 ASR 服务安装

```bash
source .venv/bin/activate
python -m pytest tests/ -v
```

如果所有测试通过（125 passed），说明安装成功。

### 4. 前端与 Tauri 安装

#### 安装前端依赖

```bash
npm install
```

主要前端依赖：

| 包名 | 用途 |
|------|------|
| react 19 | UI 框架 |
| antd 6 | UI 组件库 |
| zustand 5 | 状态管理 |
| @tauri-apps/api | Tauri 桌面 API |
| vite 7 | 构建工具 |
| typescript 5.9 | 类型系统 |

#### 验证前端构建

```bash
npm run build
```

构建成功后会在 `dist/` 目录生成前端静态文件。

### 5. Ollama 安装（智能会议纪要）

Ollama 用于本地运行 LLM 生成智能会议纪要。此步骤**可选**，不安装 Ollama 不影响核心转录功能。

#### 安装 Ollama

**Linux**:
```bash
curl -fsSL https://ollama.com/install.sh | sh
```

**macOS**:
```bash
brew install ollama
# 或下载: https://ollama.com/download/mac
```

**Windows**:
从 [ollama.com/download](https://ollama.com/download) 下载安装程序。

#### 下载推荐模型

```bash
# 启动 Ollama 服务
ollama serve

# 在另一个终端下载模型
ollama pull qwen2.5:7b       # 推荐：中英双语，7B 参数
# 或更小的模型（内存有限时）
ollama pull qwen2.5:3b       # 轻量级
```

**模型选择建议**:

| 模型 | 内存需求 | 适用场景 |
|------|---------|---------|
| qwen2.5:3b | ~4 GB | 内存有限、快速总结 |
| qwen2.5:7b | ~8 GB | **推荐**，平衡质量与速度 |
| qwen2.5:14b | ~16 GB | 高质量总结，需要大内存 |

#### 验证 Ollama

```bash
# 检查服务是否运行
curl http://localhost:11434/api/tags

# 测试生成
ollama run qwen2.5:7b "你好，请用一句话介绍自己"
```

### 6. 模型下载

#### 预置模型

项目 `meeting/models/` 目录中已包含以下中文处理模型：

| 模型 | 用途 | 大小 |
|------|------|------|
| speech_fsmn_vad_zh-cn | 语音活动检测（VAD） | ~30 MB |
| punc_ct-transformer_zh-cn | 标点还原 | ~200 MB |
| speech_campplus_sv_zh-cn | 说话人识别 | ~30 MB |
| speech_paraformer-large-vad-punc | Paraformer ASR | ~1 GB |
| speech_paraformer-large-vad-punc-spk | Paraformer + 说话人 | ~1.2 GB |

这些模型随项目一起分发，**无需额外下载**。

#### Whisper 模型（首次使用时自动下载）

Whisper 模型在首次选择使用时会自动从 HuggingFace 下载到 `models/` 目录：

| 模型大小 | VRAM 需求 | 文件大小 | 适用场景 |
|---------|----------|---------|---------|
| tiny | ~1 GB | ~75 MB | 快速预览、低配置设备 |
| base | ~1.5 GB | ~150 MB | 基础转录 |
| small | ~2 GB | ~500 MB | 日常使用 |
| medium | ~4 GB | ~1.5 GB | **推荐**，准确率高 |
| large-v3 | ~6 GB | ~3 GB | 最高准确率 |

#### 手动预下载 Whisper 模型（可选）

如果网络环境需要提前下载：

```bash
source .venv/bin/activate
python3 -c "
from faster_whisper import WhisperModel
# 下载 medium 模型（推荐）
model = WhisperModel('medium', device='cpu', compute_type='int8')
print('模型下载完成')
"
```

---

## 运行项目

### 开发模式

开发模式需要同时启动两个服务：

#### 方式一：分两个终端启动

**终端 1 — ASR 服务**:
```bash
cd openMeet
source .venv/bin/activate
python -m asr_service.main
```

看到以下输出表示启动成功：
```
INFO:     Uvicorn running on http://127.0.0.1:18090
INFO:     Application startup complete.
```

**终端 2 — Tauri 桌面应用**:
```bash
cd openMeet
npm run tauri dev
```

这会同时启动：
- Vite 开发服务器（端口 1420，热更新）
- Tauri 桌面窗口

**终端 3（可选） — Ollama 服务**:
```bash
ollama serve
```

#### 方式二：使用 tmux 一键启动

```bash
# 创建 tmux 会话
tmux new-session -d -s openmeet

# ASR 服务
tmux send-keys -t openmeet "cd $(pwd) && source .venv/bin/activate && python -m asr_service.main" Enter

# 新建窗口运行 Tauri
tmux new-window -t openmeet
tmux send-keys -t openmeet "cd $(pwd) && npm run tauri dev" Enter

# 新建窗口运行 Ollama（可选）
tmux new-window -t openmeet
tmux send-keys -t openmeet "ollama serve" Enter

# 连接到会话
tmux attach -t openmeet
```

tmux 窗口切换：`Ctrl+B` 然后 `0/1/2`

#### 验证服务是否正常

```bash
# 检查 ASR 服务
curl http://127.0.0.1:18090/health
# 期望输出: {"status":"ok"}

# 检查可用引擎
curl http://127.0.0.1:18090/engines
# 期望输出: 包含 5 个引擎的 JSON 数组

# 检查 Ollama（可选）
curl http://localhost:11434/api/tags
```

### 生产构建

#### 构建桌面应用

```bash
npm run tauri build
```

构建产物位置：

| 平台 | 路径 | 格式 |
|------|------|------|
| **Linux** | `src-tauri/target/release/bundle/deb/` | .deb |
| **Linux** | `src-tauri/target/release/bundle/appimage/` | .AppImage |
| **macOS** | `src-tauri/target/release/bundle/dmg/` | .dmg |
| **Windows** | `src-tauri/target/release/bundle/msi/` | .msi |
| **Windows** | `src-tauri/target/release/bundle/nsis/` | .exe 安装包 |

#### 打包说明

生产环境中，Tauri 会将 Python ASR 服务作为 sidecar 进程管理：
- 应用启动时自动启动 Python ASR 服务
- 应用关闭时自动停止 ASR 服务
- 用户无需手动管理后端进程

---

## 云端 API 配置（可选）

当本地 GPU 资源不足时，可以配置云端 ASR API 作为备选方案。

### OpenAI Whisper API

1. 获取 API Key：访问 [platform.openai.com](https://platform.openai.com/api-keys)
2. 设置环境变量：

```bash
export OPENAI_API_KEY="sk-your-api-key-here"
```

或在应用内通过「设置 → API 密钥」页面配置。

**计费参考**: $0.006 / 分钟音频

### 阿里云语音识别

1. 开通服务：访问 [阿里云 DashScope](https://dashscope.console.aliyun.com/)
2. 获取 AccessKey：访问 [RAM 控制台](https://ram.console.aliyun.com/)
3. 设置环境变量：

```bash
export ALIBABA_ACCESS_KEY_ID="your-access-key-id"
export ALIBABA_ACCESS_KEY_SECRET="your-access-key-secret"
```

或在应用内通过「设置 → API 密钥」页面配置。

### 自动降级策略

OpenMeet 内置智能降级机制，根据系统资源自动选择最佳引擎：

```
高 VRAM GPU (6GB+)  →  Qwen3 1.7B（中文）/ Whisper large（英文）
中 VRAM GPU (3-6GB) →  Qwen3 0.6B / Whisper medium
低 VRAM GPU (1-3GB) →  Whisper small / base
无 GPU + 有 API Key →  云端 API（OpenAI / 阿里云）
无 GPU + 无 API Key →  Whisper tiny（CPU 模式）
```

---

## 环境变量参考

| 变量名 | 必需 | 默认值 | 说明 |
|--------|------|--------|------|
| `OPENAI_API_KEY` | 否 | - | OpenAI Whisper API 密钥 |
| `ALIBABA_ACCESS_KEY_ID` | 否 | - | 阿里云 AccessKey ID |
| `ALIBABA_ACCESS_KEY_SECRET` | 否 | - | 阿里云 AccessKey Secret |
| `HF_TOKEN` | 否 | - | HuggingFace Token（pyannote 说话人分离） |
| `OLLAMA_HOST` | 否 | `http://localhost:11434` | Ollama 服务地址 |

可以创建 `.env` 文件统一管理（该文件已在 `.gitignore` 中）：

```bash
# .env 文件示例
OPENAI_API_KEY=sk-your-key-here
ALIBABA_ACCESS_KEY_ID=your-id
ALIBABA_ACCESS_KEY_SECRET=your-secret
HF_TOKEN=hf_your-token
```

---

## 项目架构

```
┌─────────────────────────────────────────────────────┐
│                   Tauri 桌面应用                      │
│  ┌──────────────────┐    ┌────────────────────────┐ │
│  │   React 前端      │◄──►│   Rust 后端 (Tauri)    │ │
│  │  - 录音控制       │ IPC│  - 进程管理             │ │
│  │  - 转录面板       │    │  - 音频捕获 (cpal)      │ │
│  │  - 会议纪要       │    │  - 文件系统             │ │
│  │  - 全文搜索       │    │  - sidecar 管理         │ │
│  │  - 设置管理       │    │                        │ │
│  └──────────────────┘    └──────────┬─────────────┘ │
└─────────────────────────────────────┼───────────────┘
                                      │ 管理
                    ┌─────────────────┼─────────────────┐
                    ▼                                    ▼
    ┌──────────────────────────┐    ┌───────────────────┐
    │  Python ASR 服务 (18090) │    │  Ollama (11434)   │
    │                          │    │                   │
    │  引擎:                   │    │  模型:             │
    │  ├─ faster-whisper       │    │  └─ qwen2.5:7b   │
    │  ├─ Qwen3-ASR           │    │                   │
    │  ├─ Paraformer           │    │  功能:             │
    │  ├─ OpenAI API           │    │  └─ 会议纪要生成   │
    │  └─ 阿里云 ASR           │    └───────────────────┘
    │                          │
    │  后处理管线:              │
    │  ITN → 标点 → 分离 → 总结│
    │                          │
    │  API 端点:               │
    │  /health  /jobs  /engines│
    │  /ws/stream  /search     │
    └──────────────────────────┘
```

### 服务端口

| 服务 | 端口 | 说明 |
|------|------|------|
| ASR 服务 | 18090 | FastAPI REST + WebSocket |
| Vite 开发服务器 | 1420 | 前端热更新（仅开发模式） |
| Ollama | 11434 | LLM 推理服务 |

---

## ASR 引擎选择指南

### 引擎对比

| 引擎 | 语言 | 速度 | 准确率 | VRAM | 特点 |
|------|------|------|--------|------|------|
| **faster-whisper** | 100+ 语言 | ★★★★ | ★★★★ | 1-6 GB | 多语言最佳、模型大小可选 |
| **Qwen3-ASR** | 中文方言为主 | ★★★ | ★★★★★ | 3-6 GB | 中文最准、支持粤语/吴语 |
| **Paraformer** | 中文 | ★★★★★ | ★★★★ | ~2 GB | 中文最快（10x 实时） |
| **OpenAI API** | 100+ 语言 | ★★★ | ★★★★★ | 无需 | 无需 GPU、按量计费 |
| **阿里云 ASR** | 中文 | ★★★★ | ★★★★★ | 无需 | 中文优化、按量计费 |

### 推荐方案

**中文会议（首选方案）**:
- GPU 充足 → Qwen3-ASR 1.7B
- GPU 有限 → Paraformer（最快）
- 无 GPU → 阿里云 ASR API

**英文/多语言会议**:
- GPU 充足 → Whisper large-v3
- GPU 有限 → Whisper medium
- 无 GPU → OpenAI Whisper API

**多语言混合会议**:
- Whisper medium/large（自动语言检测）

---

## 常见问题排查

### 1. ASR 服务启动失败

**问题**: `ModuleNotFoundError: No module named 'asr_service'`

```bash
# 确保在项目根目录运行，且虚拟环境已激活
cd openMeet
source .venv/bin/activate
python -m asr_service.main
```

**问题**: 端口 18090 被占用

```bash
# 查找占用进程
lsof -i :18090              # Linux/macOS
netstat -ano | findstr 18090 # Windows

# 终止进程
kill -9 <PID>
```

### 2. Tauri 构建失败

**问题**: `error: could not find system library 'webkit2gtk-4.1'`

```bash
# Ubuntu/Debian
sudo apt install libwebkit2gtk-4.1-dev
```

**问题**: Rust 编译错误

```bash
rustup update
cargo clean
npm run tauri dev
```

### 3. 模型下载缓慢或失败

**问题**: HuggingFace 下载慢

```bash
# 使用镜像源
export HF_ENDPOINT=https://hf-mirror.com

# 或手动下载后放到 models/ 目录
```

**问题**: Ollama 模型下载失败

```bash
# 检查网络连接
curl -I https://ollama.com

# 重试下载
ollama pull qwen2.5:7b
```

### 4. GPU 相关问题

**问题**: CUDA 不可用

```bash
# 检查 NVIDIA 驱动
nvidia-smi

# 检查 CUDA 版本
nvcc --version

# Python 中验证
python3 -c "import torch; print(torch.cuda.is_available())"
```

**问题**: VRAM 不足

```
选择更小的模型：
- Whisper: large → medium → small → base → tiny
- Qwen3: 1.7B → 0.6B
或切换到 CPU 模式（较慢但不需 GPU）
```

### 5. 音频相关问题

**问题**: 麦克风无法录音

```bash
# Linux: 检查 ALSA
arecord -l                    # 列出录音设备
sudo apt install libasound2   # 安装 ALSA 库

# macOS: 检查系统偏好设置 → 安全性与隐私 → 麦克风权限

# Windows: 检查设置 → 隐私 → 麦克风
```

**问题**: FFmpeg 未安装

```bash
# 验证
ffmpeg -version

# 安装
sudo apt install ffmpeg       # Ubuntu/Debian
brew install ffmpeg            # macOS
winget install Gyan.FFmpeg     # Windows
```

### 6. Ollama 连接失败

**问题**: `Connection refused to localhost:11434`

```bash
# 确保 Ollama 正在运行
ollama serve

# 检查端口
curl http://localhost:11434/api/tags

# 如果使用自定义地址
export OLLAMA_HOST=http://your-host:11434
```

---

## 更新升级

### 从 Git 仓库更新

```bash
cd openMeet

# 1. 拉取最新代码
git pull origin main

# 2. 更新 Python 依赖
source .venv/bin/activate
pip install -r asr_service/requirements.txt --upgrade

# 3. 更新前端依赖
npm install

# 4. 验证
python -m pytest tests/ -v
npm run build
```

### 更新模型

```bash
# 更新 Ollama 模型
ollama pull qwen2.5:7b

# Whisper 模型会在选择新版本时自动下载
# 手动清理旧模型
rm -rf models/whisper-*
```

### 版本回滚

如果更新后出现问题：

```bash
# 查看版本历史
git log --oneline -10

# 回滚到指定版本
git checkout <commit-hash>

# 重新安装依赖
pip install -r asr_service/requirements.txt
npm install
```

---

## 卸载

### 完全卸载

```bash
# 1. 停止所有服务
# 关闭 Tauri 应用窗口
# Ctrl+C 停止 ASR 服务
# Ctrl+C 停止 Ollama

# 2. 删除项目目录
rm -rf openMeet

# 3. 删除 Ollama 模型（可选）
ollama rm qwen2.5:7b
# 卸载 Ollama
# Linux: sudo rm /usr/local/bin/ollama && rm -rf ~/.ollama
# macOS: 删除 Ollama.app 并 rm -rf ~/.ollama
```

### 仅清理模型（释放磁盘空间）

```bash
cd openMeet

# 清理 Whisper 模型缓存（约 1-5 GB）
rm -rf models/

# 清理 Ollama 模型
ollama rm qwen2.5:7b
```

---

## 运行测试

```bash
source .venv/bin/activate

# 运行全部测试
python -m pytest tests/ -v

# 运行测试并查看覆盖率
python -m pytest tests/ --cov=asr_service --cov-report=term-missing

# 运行特定测试文件
python -m pytest tests/asr_service/test_search.py -v

# 前端类型检查
npx tsc --noEmit
```

---

## 开发者参考

### API 端点一览

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/health` | 健康检查 |
| GET | `/engines` | 列出所有引擎及其状态 |
| POST | `/jobs` | 创建转录任务 |
| GET | `/jobs/{id}` | 获取任务状态 |
| POST | `/jobs/{id}/start` | 开始转录 |
| PUT | `/jobs/{id}/pause` | 暂停转录 |
| PUT | `/jobs/{id}/resume` | 恢复转录 |
| PUT | `/jobs/{id}/cancel` | 取消任务 |
| GET | `/jobs/{id}/result` | 获取转录结果 |
| GET | `/jobs/{id}/export` | 导出（`?format=markdown\|json\|txt`） |
| WS | `/ws/jobs/{id}/stream` | 实时音频流 WebSocket |
| GET | `/search` | 全文搜索（`?q=关键词`） |

### 配置文件位置

| 文件 | 用途 |
|------|------|
| `asr_service/config.py` | ASR 服务配置（端口、引擎、模型路径） |
| `src-tauri/tauri.conf.json` | Tauri 应用配置（窗口、权限、打包） |
| `vite.config.ts` | Vite 构建配置 |
| `tsconfig.json` | TypeScript 配置 |
| `pytest.ini` | 测试配置 |
| `.env` | 环境变量（需自行创建） |
