# OpenMeet 配置指南

> 第一次打开 OpenMeet 面对一堆模型不知道选哪个？这份指南按 **硬件** 和 **使用场景** 给出直接可抄的推荐配置。
> 所有设置都在应用右上角 ⚙️ 设置 里，模型在应用内一键下载（魔搭国内源，无需账号）。

---

## 0. 三分钟最小可用配置

只做这三步就能跑通"录音 → 转录 → 纪要"：

| 步骤 | 位置 | 选什么 |
|---|---|---|
| ① 选 ASR 引擎并下载模型 | 设置 → ASR 模型 | 有 NVIDIA 显卡：**Qwen3-ASR → qwen3-asr-1.7B**；没显卡：**Paraformer → paraformer-large-vad-punc** |
| ② 配一个 LLM | 设置 → LLM 模型 | 最省事：**DeepSeek**（填 API Key 即可，便宜好用）；想纯本地：**Ollama** + `ollama pull qwen3:8b` |
| ③ 下载说话人分离模型 | 设置 → ASR 模型 → 说话人分离 | **pyannote community-1**（仅 ~32MB，必装，否则分不出谁在说话） |

其余保持默认即可。想进一步优化，往下看。

---

## 1. 按硬件选配置

先看你的机器属于哪一档，这决定了本地模型能跑多大。

| 档位 | 典型配置 | ASR 引擎 / 规格 | 说话人分离 | 强制对齐 | 知识库 Embedding | LLM |
|---|---|---|---|---|---|---|
| **A · 无独显 / 核显** | 笔记本、Mac Intel、办公机 | Paraformer `paraformer-large-vad-punc`（CPU 也很快）<br/>或 faster-whisper `small` | pyannote community-1（CPU 可跑，慢一些） | 自动回退 MMS_FA（CPU） | BGE-small-zh（0.3GB） | 云端 API（DeepSeek / 通义） |
| **B · 6–8GB 显存** | RTX 3060 / 4060 / 2070 | Qwen3-ASR `qwen3-asr-1.7B`<br/>或 faster-whisper `medium` | pyannote community-1 | Qwen3-ForcedAligner-0.6B | Qwen3-Embedding-0.6B（1.5GB） | 云端 API；本地可用 Ollama `qwen3:8b`（量化版） |
| **C · 12–16GB 显存** | RTX 4070 Ti / 4080 / 3090（12G 版） | Qwen3-ASR `qwen3-asr-1.7B`<br/>或 faster-whisper `large-v3` | pyannote community-1 | Qwen3-ForcedAligner-0.6B | Qwen3-Embedding-0.6B（性价比）或 BGE-M3（多语言） | Ollama `qwen3:14b` |
| **D · 24GB+ 显存** | RTX 3090 / 4090 / A 系列 | faster-whisper `large-v3` 或 Qwen3-ASR 1.7B，按语言选 | pyannote community-1 | Qwen3-ForcedAligner-0.6B | Qwen3-Embedding-4B | Ollama `qwen3:32b` / `deepseek-r1:32b` |
| **Apple Silicon (M 系列)** | M1–M4，16GB+ 统一内存 | faster-whisper `medium` / Paraformer | pyannote community-1 | MMS_FA | Qwen3-Embedding-0.6B | Ollama `qwen3:8b` |

> 显存不够时应用会自动降级到 CPU 运行，不会崩，但会慢很多。**转录速度慢首先检查是不是掉到了 CPU**（ASR 服务启动日志里会打印 `device=cuda` 或 `device=cpu`）。

---

## 2. 按场景选配置

### 场景 1：日常中文会议（最常见）

| 项目 | 推荐 | 原因 |
|---|---|---|
| ASR | **Qwen3-ASR 1.7B**（有显卡）/ **Paraformer large-vad-punc**（无显卡） | 两者中文准确率都明显好于 whisper；Paraformer 在 CPU 上也能达到近实时 |
| 识别语言 | 中文（不要选自动检测） | 固定语言可避免中英混杂时误判 |
| AI 纠错 | 开 | 修同音字、专有名词，效果立竿见影 |
| 文本规范化 (ITN) | 开 | 「二零二六年三月」→「2026年3月」 |
| 口语清理 | 开 | 去掉"嗯、啊、那个" |

### 场景 2：中英混合 / 外语会议

| 项目 | 推荐 |
|---|---|
| ASR | **faster-whisper large-v3**（显存 ≥10GB）或 **medium**（6GB）；Qwen3-ASR 也支持 30+ 语言，中英混合可优先试 Qwen3 |
| 识别语言 | 中英混合选 **自动检测**；纯外语选对应语种 |
| Embedding | **BGE-M3** 或 Qwen3-Embedding（都支持多语言）；BGE-small-zh 只适合纯中文 |

### 场景 3：方言、口音重、环境嘈杂

| 项目 | 推荐 |
|---|---|
| ASR | **Qwen3-ASR 1.7B** —— 支持粤语、四川话、闽南语等方言，噪声鲁棒性最好 |
| 幻觉检测 | 开（嘈杂音频容易让模型"脑补"出不存在的话） |

### 场景 4：实时字幕 / 边开会边出字

| 项目 | 推荐 |
|---|---|
| ASR | 只有 **Qwen3-ASR** 和 **Paraformer**（`paraformer-online`）支持流式；whisper 不支持 |
| 说话人分离 | 实时模式下不做分离，录完后点「重新后处理」再分离 |

### 场景 5：纯离线 / 内网 / 保密要求高

| 项目 | 推荐 |
|---|---|
| ASR | 本地任意引擎（不要选 OpenAI Whisper API / 阿里云 ASR） |
| LLM | **Ollama** 本地模型；显存不够可以关闭「AI 纠错」只保留摘要 |
| Embedding | 本地模型（BGE / Qwen3-Embedding），不要选云厂商 Embedding |
| 部署 | 用离线整合包一次性装好所有模型，之后拔网线照常用 |

### 场景 6：没显卡也不想装本地模型（"全云端"）

| 项目 | 推荐 |
|---|---|
| ASR | **OpenAI Whisper API** 或 **阿里云 ASR**（填 Key 即用） |
| LLM | DeepSeek / 通义千问 / 任意云厂商 |
| Embedding | 通义千问 `text-embedding-v3` 或硅基流动 |
| 说话人分离 | 仍需下载 pyannote（本地小模型，CPU 可跑）—— 云端 ASR 不带分离 |

### 场景 7：追求最高质量，不在乎时间

- ASR：faster-whisper **large-v3**（外语）/ Qwen3-ASR **1.7B**（中文）
- LLM：`deepseek-reasoner`、`qwen3-max`、`gpt-5.2`、`gemini-3.1-pro` 任一旗舰
- Embedding：Qwen3-Embedding-4B / 8B，并开启 **Rerank**（通义 `gte-rerank-v2` 或硅基流动 `bge-reranker-v2-m3`）
- 全部后处理开关打开

---

## 3. ASR 引擎详解

| 引擎 | 规格 | 下载体积 | 显存需求 | 语言 | 流式 | 适合 |
|---|---|---|---|---|---|---|
| **Qwen3-ASR** | `qwen3-asr-0.6B` | ~1.3GB | ~2GB | 中英 + 30 语种 + 方言 | ✅ | 显存紧张时的中文首选 |
| | `qwen3-asr-1.7B` | ~3.5GB | ~4GB | 同上 | ✅ | **中文综合推荐** |
| **Paraformer** (FunASR) | `paraformer-large` | ~1GB | CPU 即可 | 中文 | ❌ | 纯转写 |
| | `paraformer-large-vad-punc` | ~1.1GB | CPU 即可 | 中文 | ❌ | **无显卡中文首选**（自带断句标点） |
| | `paraformer-large-vad-punc-spk` | ~1.2GB | CPU 即可 | 中文 | ❌ | 自带简易说话人区分 |
| | `paraformer-online` | ~1GB | CPU 即可 | 中文 | ✅ | 实时字幕 |
| **faster-whisper** | `tiny` / `base` | 150MB / 290MB | <1GB | 99 语种 | ❌ | 快速试用、英文短音频 |
| | `small` | 950MB | ~2GB | 99 语种 | ❌ | 无显卡的多语言方案 |
| | `medium` | 3GB | ~5GB | 99 语种 | ❌ | 外语会议均衡选择 |
| | `large-v3` | 6GB | ~10GB | 99 语种 | ❌ | **外语 / 多语言最高质量** |
| **OpenAI Whisper API** | — | 无 | 无 | 99 语种 | ❌ | 全云端 |
| **阿里云 ASR** | — | 无 | 无 | 中英 | ❌ | 全云端 |
| **自定义模型** | 任意魔搭仓库 | — | — | — | — | 自己微调过的模型 |

**一句话选择法**：中文 → Qwen3-ASR（有卡）/ Paraformer（无卡）；外语 → whisper；要实时 → Qwen3-ASR 或 paraformer-online。

---

## 4. LLM 选择

LLM 在 OpenMeet 里干三件事：**AI 纠错**（改转录稿）、**生成纪要 / 思维导图**、**知识库问答**。

### 云端 vs 本地

| | 云端 API | 本地 Ollama |
|---|---|---|
| 质量 | 高（旗舰模型） | 取决于显存能跑多大 |
| 速度 | 快 | 8B 模型在 12GB 卡上可接受，纠错长会议要等几分钟 |
| 费用 | 按 token 计费，一场 1 小时会议约几分钱到几毛钱 | 免费 |
| 隐私 | 转录文本会发到厂商服务器 | 完全本地 |

**建议**：对隐私不敏感 → 云端；敏感 → Ollama，显存 <12GB 时关闭「AI 纠错」（最吃 token 的一步），只用 LLM 做摘要。

### 推荐模型

| 提供商 | 推荐模型 | 说明 |
|---|---|---|
| DeepSeek | `deepseek-chat` | **默认推荐**：便宜、中文好、纪要结构化能力强 |
| 通义千问 | `qwen3.5-flash`（快/便宜）/ `qwen3-max`（质量） | 同时提供 Embedding 和 Rerank，一家配齐 |
| 智谱 | `glm-4.7-flash`（免费额度）/ `glm-5` | |
| Moonshot | `kimi-latest` | 长上下文，超长会议一次性摘要 |
| OpenAI / Gemini | `gpt-4.1-mini` / `gemini-2.5-flash` | 国内网络需自行解决访问 |
| Ollama（本地） | `qwen3:8b`（8GB 卡）/ `qwen3:14b`（12GB）/ `qwen3:32b`（24GB） | 中文本地首选；`deepseek-r1` 系列思考慢，不推荐做纠错 |

> API Key 在本地用 RSA-OAEP 加密存储，不会上传到任何地方。
> 一个提供商可同时勾选多个模型，在「通用 → 默认 LLM 模型」里切换当前使用哪个。

---

## 5. 知识库（Embedding / Rerank）

Embedding 决定"用自然语言搜历史会议"的召回质量。

| 模型 | 参数 | 显存 | 语言 | 推荐场景 |
|---|---|---|---|---|
| BGE-small-zh | 33M | 0.3GB | 中文 | 无显卡 / 只要中文 |
| **Qwen3-Embedding-0.6B** | 0.6B | 1.5GB | 多语言 | **默认推荐**，中文效果超 BGE-M3 |
| BGE-M3 | 568M | 2GB | 多语言 | 中英混合、稳定 |
| Qwen3-Embedding-4B | 4B | 10GB | 多语言 | 12GB+ 显卡追求效果 |
| Qwen3-Embedding-8B | 8B | 18GB | 多语言 | 24GB 显卡 |
| 云端 Embedding | — | 无 | — | 通义 `text-embedding-v3`、硅基流动 `BAAI/bge-m3` |

**Rerank**（可选）：检索后再精排，明显提升问答准确度，代价是多一次 API 调用。通义 `gte-rerank-v2` 或硅基流动 `BAAI/bge-reranker-v2-m3` 二选一，在「知识库 → 启用 Rerank」打开。

> ⚠️ 不同 Embedding 模型的向量互不兼容，切换后历史会议需要重新索引（重新后处理该会议即可触发），建议选定后不要频繁更换。

---

## 6. 说话人分离与声纹

| 设置 | 推荐值 | 说明 |
|---|---|---|
| 说话人分离 | 开 | 模型 pyannote community-1，只有 32MB，CPU 也能跑 |
| 发言人数 | 点「重新后处理」时按实际填 | **知道人数一定要填**——自动检测在 2 人对话中经常多切出 1–2 个"幽灵说话人" |
| 声纹识别阈值 | **50%（默认）** | 越高越严格。调到 70% 以上会导致同一个人每次开会都被当成新人；低于 40% 会把不同人合并 |
| 声纹库 | 第一次识别后把「未知说话人 N」改成真名 | 之后每场会议自动认出；识别错了在转录页把段落指派给正确的人，声纹会被动学习修正 |

**声纹越用越准**：每次匹配成功都会把新样本融合进档案，前 20 次权重递减，之后固定 ~5% 权重持续微调。

---

## 7. 后处理开关

设置 → 通用 → 转录后处理。默认全开，下面是每一项的取舍：

| 开关 | 干什么 | 建议 |
|---|---|---|
| 幻觉检测 | 删掉 ASR 在静音/噪声处"脑补"的句子（如反复的"谢谢观看"） | 开 |
| 文本规范化 (ITN) | 口语数字 → 阿拉伯数字，日期、金额规范化 | 开；法律 / 逐字稿场景可关 |
| 口语清理 | 去"嗯 / 啊 / 那个 / 就是说"和重复 | 开；要保留原话语气可关 |
| AI 纠错 | LLM 修同音字、专有名词、错别字 | 有云端 LLM 就开；本地小模型或想省钱可关 |
| 语义分段 | 按停顿和语义切段落 | 开 |
| 标点恢复 | 给无标点引擎（whisper 部分情况）补标点 | 开；Paraformer-vad-punc 自带标点，开着也无害 |
| 说话人分离 | 见第 6 节 | 开 |

后处理是**串行流水线**，AI 纠错和说话人分离已并行调度；一场 1 小时会议在 B 档机器上约 3–5 分钟，进度会实时显示在转录页顶部。

---

## 8. 常见问题

**Q：模型下载失败 / 卡住？**
所有模型走魔搭国内源，正常几分钟能下完。如果公司网络限制，用离线整合包（README 里有链接），解压到缓存目录即可。

**Q：转录特别慢？**
① 检查是否掉到 CPU（显存不足会自动降级）；② whisper `large-v3` 在 CPU 上极慢，换 `small` 或 Paraformer；③ 关闭「AI 纠错」看是不是 LLM 卡住了。

**Q：识别出来的说话人比实际多？**
点「重新后处理」时填写准确的发言人数；确认声纹阈值没有被调高。

**Q：纪要为空 / 生成失败？**
设置 → LLM 模型 看提供商是否「已配置」且至少启用了一个模型；「通用 → 默认 LLM 模型」是否选中了它。

**Q：缓存目录能换盘吗？**
可以，设置 → 通用 → 缓存目录，选一个大容量盘，模型、音频、附件都会放在那里。已下载的模型需要手动移动 `models/` 子目录过去。

**Q：想用自己微调的模型？**
设置 → ASR 模型 → 自定义模型，填魔搭仓库 ID（如 `your-org/your-model`），要求是 transformers 可直接加载的语音识别模型（`automatic-speech-recognition` pipeline 格式）。
