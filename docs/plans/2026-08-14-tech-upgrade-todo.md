# 技术选型升级调研与待办（2026-08-14）

方案定型于 2026-03，本文是 5 个月后的复查结论。已完成项打勾，其余按优先级排序留作待办。

## 已完成（2026-08-14）

- [x] **说话人分离：pyannote 3.1 → community-1**
  官方数据整体准确率提升约 28%，AliMeeting DER 24.5%→20.3%。已缓存 3.1 的旧安装自动回退可用，下载入口只提供 community-1（gated，需 HF Token + 网页接受协议，~160MB）。
- [x] **RAG embedding 默认：BGE-small-zh → Qwen3-Embedding-0.6B**
  2026 年中文本地 embedding 性价比首选（C-MTEB 超 BGE-M3 近 10%）。维度 512→1024，切换后 LanceDB 自动重建索引。
- [x] **强制对齐：MMS_FA → Qwen3-ForcedAligner-0.6B（主）+ MMS_FA（回退）**
  中文按字、英文按词直接对齐，免去拼音罗马化；RTF ~0.001。单次上限约 5 分钟，长音频按句子粗估时间分窗（240s/窗）对齐；粗估不可用（如零时长片段 + 长音频）时回退 MMS_FA。

## 待办（按投入产出排序）

- [ ] **faster-whisper 默认档加 large-v3-turbo**（CT2 社区转换版 `deepdml/faster-whisper-large-v3-turbo-ct2`）：速度显著快于 large-v3、质量接近；改模型映射即可。
- [ ] **纪要 LLM 默认推荐改 Qwen3.5-9B / 4B**（2026-03，Apache-2.0）：10B 以下最强，4B Q4 量化仅 ~2.5GB；Ollama 路径不变，改推荐列表即可。上线前以 HF 官方 model card 复核。
- [ ] **中文 ASR 主力评估 FireRedASR2-AED（1B）**：公开中文 SOTA（普通话 CER 3.05%、方言 11.55%），自带 VAD/标点/词级时间戳，RTF 0.068-0.087；作为新 engine 接入（协议已抽象），约数天工作量。LLM 版（8B）精度更高但部署重。
- [ ] **声纹模型评估 ERes2NetV2**（3D-Speaker，200k 说话人预训练版）：短语音（2-5s 会议片段）明显更强、中文数据占比高；维度变化需声纹库迁移（机制已有）。
- [ ] **sherpa-onnx Rust"轻量模式"**：2026 年能力矩阵已覆盖 ASR（含 Qwen3-ASR/SenseVoice/Paraformer/FireRedASR）/VAD/标点/说话人分离/声纹，官方 Rust binding。可做免 Python 依赖的即装即用模式（小模型实时字幕），与 Python sidecar"高精度模式"并存。整体替换不可行：高精度档模型缺失，RAG 离不开 Python。
- [ ] **观察：端到端"转写+说话人分离"一体模型**：截至 2026-08 开源侧未成熟（WhisperX 仍是拼装；SpeakerLM 等在论文阶段），维持"ASR + pyannote 后归并"架构。

## 明确不换

- **Qwen3-ASR**：截至 2026-08 无新版本（仍 0.6B/1.7B），保留。
- **NVIDIA Parakeet/Canary/Sortformer**：仅欧洲语言 / 限 4 说话人英文为主，不适合中文会议。
- **SenseVoice-Small**：快但无时间戳；**Kimi-Audio-7B**：偏音频理解，部署重；**Moonshine**：英文向。
- **bge-m3**：仍是稳健选择，但被 Qwen3-Embedding 超越，不再作默认。

## 关键来源

- FireRedASR2S: https://github.com/FireRedTeam/FireRedASR2S （权重 2026-02，报告 2026-03）
- pyannote community-1: https://huggingface.co/pyannote/speaker-diarization-community-1 （2025-09）
- Qwen3-ForcedAligner-0.6B: https://huggingface.co/Qwen/Qwen3-ForcedAligner-0.6B
- faster-whisper large-v3-turbo CT2: https://huggingface.co/deepdml/faster-whisper-large-v3-turbo-ct2
- Qwen3.5 小模型: https://artificialanalysis.ai/articles/qwen3-5-small-models （2026-03）
- 3D-Speaker (ERes2NetV2): https://github.com/modelscope/3D-Speaker
- sherpa-onnx: https://github.com/k2-fsa/sherpa-onnx
