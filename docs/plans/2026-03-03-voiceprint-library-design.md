# 音色库（Voiceprint Library）设计文档

日期：2026-03-03

## 概述

为 OpenMeet 新增全局音色库功能，使用 ECAPA-TDNN 模型提取说话人嵌入向量，持久化存储到 SQLite，实现跨会议的自动说话人识别。未知说话人自动建档，已知说话人通过被动学习持续优化识别精度。

## 技术方案

**架构方案：B+C（ECAPA-TDNN + 被动学习）**

- 嵌入模型：FunASR ECAPA-TDNN（`speech_eres2net_sv_zh-cn_16k-common`，192 维输出，~80MB）
- 存储：SQLite BLOB（元数据 + 嵌入向量全在一个库里，利于未来云同步）
- 作用域：全局共享（所有会议共用一个音色库）
- 匹配时机：后处理阶段（录音停止后 post-process pipeline 中执行）

## 数据模型

### voiceprints 表

```sql
CREATE TABLE IF NOT EXISTS voiceprints (
    id            TEXT PRIMARY KEY,           -- UUID
    name          TEXT NOT NULL DEFAULT '',    -- 姓名
    nickname      TEXT DEFAULT '',             -- 昵称
    email         TEXT DEFAULT '',             -- 邮箱
    department    TEXT DEFAULT '',             -- 部门
    title         TEXT DEFAULT '',             -- 职位
    note          TEXT DEFAULT '',             -- 备注
    avatar_path   TEXT,                        -- 头像文件路径（可选）
    embedding     BLOB NOT NULL,              -- 嵌入向量（192 × float32 = 768 bytes）
    sample_count  INTEGER NOT NULL DEFAULT 1, -- 累计采样次数（用于滚动平均）
    model_version TEXT NOT NULL DEFAULT '',    -- 模型版本标识（维度变化时需重提取）
    created_at    TEXT NOT NULL,              -- 创建时间 ISO8601
    updated_at    TEXT NOT NULL,              -- 最后更新时间
    last_seen_at  TEXT                        -- 最后识别到的时间
);
```

### segments 表变更

```sql
ALTER TABLE segments ADD COLUMN voiceprint_id TEXT REFERENCES voiceprints(id);
```

显示逻辑：优先用 `voiceprint_id` 关联查 name，fallback 到 `speaker` 字段。旧数据不受影响。

## 处理流程

### 后处理 Pipeline

```
录音停止 → 转录完成(COMPLETED)
  → Step 1: ITN（逆文本正则化）
  → Step 2: Punctuation（标点恢复）
  → Step 3: Speaker Identification（改造重点）
      Python 端：
        3a. 用 ECAPA-TDNN 提取每个 segment 的嵌入向量
        3b. 返回 segments + embeddings 给前端
      前端 → Rust 端：
        3c. 调 Tauri 命令 voiceprint_match，传入 embeddings
        3d. Rust 从 SQLite 加载音色库，做余弦相似度比对
            ├─ 相似度 ≥ 0.65 → 匹配已知说话人
            └─ 相似度 < 0.65 → 标记为未知
        3e. 未知 segment 之间聚类，每个聚类创建新音色条目
        3f. 已匹配说话人触发被动学习更新嵌入
        3g. 返回匹配结果
      前端：
        3h. 将 voiceprint_id 和 name 写回 segments 显示
  → READY
```

### 跨进程通信

Python 只做模型推理，不碰音色库。音色库全部由 Rust/Tauri 端管理：

- Python 端：post-process 返回结果增加 `embeddings` 字段
- Rust 端：新增 `voiceprint_match` 等 Tauri 命令
- 前端：编排调用，连接两端

## 接口设计

### Python 端

```python
# POST /jobs/{id}/post-process 响应增加 embeddings
{
  "segments": [...],
  "embeddings": [           # 与 segments 一一对应
    [0.12, -0.34, ...],    # 192 维 float32
    null,                   # segment < 0.3s 无嵌入
    ...
  ]
}
```

### Rust 端（Tauri 命令）

```rust
// 核心比对命令
fn voiceprint_match(
    embeddings: Vec<Option<Vec<f32>>>,
    threshold: f64,
) -> Result<VoiceprintMatchResult, String>

// 音色库 CRUD
fn voiceprint_list() -> Vec<VoiceprintInfo>
fn voiceprint_get(id: String) -> VoiceprintInfo
fn voiceprint_update(id: String, metadata: VoiceprintMetadata) -> ()
fn voiceprint_delete(id: String) -> ()
fn voiceprint_merge(source_id: String, target_id: String) -> ()
```

## 被动学习机制

用户在转录面板确认/修正说话人标签时触发：

```
emb_updated = (emb_old × sample_count + emb_new) / (sample_count + 1)
emb_updated = emb_updated / ||emb_updated||   # L2 归一化
sample_count += 1
```

保护措施：
- `sample_count` 上限 100，达到后改为指数衰减：`emb = old × 0.95 + new × 0.05`
- 防止嵌入固化，能适应说话人声音随时间的自然变化

## 阈值策略

| 相似度范围 | 行为 |
|-----------|------|
| ≥ 0.65 | 自动匹配已知说话人 |
| 0.50 - 0.65 | 低置信，UI 提示"可能是 XXX" |
| < 0.50 | 视为未知说话人 |

默认阈值 0.65，可在设置中调节。

## 前端 UI

### 音色库管理页面

在设置页或侧边栏新增「音色库」入口：
- 列表展示所有音色条目，按最近识别时间排序
- 编辑弹窗：姓名、昵称、邮箱、部门、职位、备注
- 合并功能：选中两个音色合并（嵌入加权平均）
- 删除功能

### 转录面板说话人选择器（改造 SpeakerBadge）

点击说话人标签弹出选择器：
- 搜索框 + 匹配推荐（带相似度百分比）
- 全部音色列表
- 输入新名字 / 创建新音色 操作

## 边界情况

| 场景 | 处理 |
|------|------|
| segment < 0.3s | 不提取嵌入，标记为 null |
| 音色库为空（首次使用） | 全部 segment 聚类后创建新音色条目 |
| 多个 segment 匹配同一人 | 取所有嵌入平均值做一次被动学习更新 |
| 删除音色后旧 segment | voiceprint_id 置 null，保留 speaker 文本不变 |
| 合并音色 | target 嵌入 = 加权平均，source 关联改指向 target，删除 source |
| 模型升级嵌入维度变化 | model_version 字段标识，版本不匹配时标记需重新提取 |
