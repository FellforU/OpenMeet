# OpenMeet v2 产品设计文档

> 日期：2026-02-26
> 状态：设计阶段

---

## 一、产品定位与愿景

**当前状态：** 本地优先的 AI 会议转录工具（工具属性）
**目标状态：** 本地优先的 AI 会议知识平台（平台属性）

核心理念：**AI 算力零成本** —— 所有 AI 能力（ASR、LLM、Embedding）均运行在用户本地或用户自配的云端 API，平台不承担算力成本。

**目标用户路线：** 个人用户 → 小团队 → 企业（渐进式）

---

## 二、功能架构总览

```
┌─────────────────────────────────────────────────────────────────────┐
│                        OpenMeet v2 功能地图                         │
├───────────────┬──────────────┬──────────────┬──────────────────────┤
│  Phase 1      │  Phase 2     │  Phase 3     │  Phase 4             │
│  数据基座     │  知识平台    │  效率集成    │  商业化              │
├───────────────┼──────────────┼──────────────┼──────────────────────┤
│ ☐ SQLite DB   │ ☐ 知识库问答 │ ☐ 飞书日历   │ ☐ 用户系统(Casdoor)  │
│ ☐ 附件管理    │ ☐ MCP Server │ ☐ 飞书会议   │ ☐ License 验证       │
│ ☐ 笔记页签    │ ☐ 向量索引   │ ☐ Google Cal │ ☐ 付费功能门控       │
│ ☐ 文件关联    │ ☐ 悬浮问答   │ ☐ Google Meet│ ☐ 云同步(付费)       │
│               │ ☐ 统计分析   │ ☐ 腾讯会议   │ ☐ 团队协作(付费)     │
└───────────────┴──────────────┴──────────────┴──────────────────────┘
```

---

## 三、Phase 1：数据基座（2-3 周）

### 3.1 SQLite 数据库

**目标：** 替换 localStorage，为所有持久化数据提供可靠存储。

**技术方案：**
- Rust 端使用 `rusqlite` 通过 Tauri Command 暴露 CRUD 接口
- 前端 store 改为调用 Tauri IPC 读写，去掉 Zustand persist middleware
- 数据库文件存储在 `{app_data_dir}/openmeet.db`

**数据表设计：**

```sql
-- 项目/文件夹
CREATE TABLE projects (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  parent_id   TEXT REFERENCES projects(id) ON DELETE CASCADE,
  is_folder   BOOLEAN NOT NULL DEFAULT 0,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  audio_path  TEXT,
  duration_ms INTEGER,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

-- 转录段落
CREATE TABLE segments (
  id         TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  start_time REAL NOT NULL,
  end_time   REAL NOT NULL,
  text       TEXT NOT NULL,
  speaker    TEXT,
  confidence REAL
);

-- 摘要
CREATE TABLE summaries (
  id              TEXT PRIMARY KEY,
  project_id      TEXT UNIQUE NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  topic           TEXT,
  conclusions     TEXT,  -- JSON array
  action_items    TEXT,  -- JSON array
  discussion      TEXT,  -- JSON array
  raw_markdown    TEXT,
  edited_markdown TEXT
);

-- 附件
CREATE TABLE attachments (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  filename    TEXT NOT NULL,
  file_path   TEXT NOT NULL,
  file_size   INTEGER NOT NULL,
  mime_type   TEXT NOT NULL,
  created_at  TEXT NOT NULL
);

-- 笔记
CREATE TABLE notes (
  id         TEXT PRIMARY KEY,
  project_id TEXT UNIQUE NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  content    TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL
);

-- 设置 (KV store)
CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
```

### 3.2 附件管理

**目标：** 每个会议支持关联文件，含元数据管理。

**支持格式：**
- 文档：PDF、DOCX、TXT、MD、PPTX、XLSX
- 图片：PNG、JPG、JPEG、GIF、WEBP、SVG

**存储策略：**
- 文件复制到 `{app_data_dir}/attachments/{project_id}/{filename}`
- 元数据（文件名、大小、类型、路径）存入 SQLite `attachments` 表
- Rust 端负责文件复制和路径管理

**UI 设计：**
- Workspace 新增「附件」页签（与转录、摘要并列）
- 支持拖拽上传 + 文件选择器
- 列表展示：文件图标 + 文件名 + 大小 + 上传时间
- 右键菜单：打开、删除、在文件管理器中显示

### 3.3 笔记页签

**目标：** 每个会议有独立的自由文本笔记区域。

**UI 设计：**
- Workspace 新增「笔记」页签
- Markdown 编辑器（使用 textarea + 实时预览，或集成轻量编辑器如 @uiw/react-md-editor）
- 自动保存（debounce 1s 后写入 SQLite）
- 笔记内容参与知识库索引

### 3.4 文件关联

会议与附件、笔记、音频、转录、摘要形成完整的知识单元：

```
Meeting (Project)
├── audio.wav          （录制/上传的音频）
├── transcript         （转录段落列表）
├── summary            （AI 摘要）
├── notes              （自由笔记）
└── attachments/       （关联文件）
    ├── meeting_slides.pdf
    ├── screenshot.png
    └── reference.docx
```

---

## 四、Phase 2：知识平台（3-4 周）

### 4.1 向量索引

**技术栈：**
- **Embedding 模型：** BGE-small-zh-v1.5（本地，384 维，~100MB）
  - 中英文双语支持
  - 通过 Python sidecar 加载（sentence-transformers）
  - 后续可配置为云端 Embedding API
- **向量数据库：** LanceDB（内嵌式，零安装）
  - 数据存储在 `{app_data_dir}/lance/`
  - Python API 直接调用，无需独立服务

**索引内容：**
1. 转录文本 —— 按 segment 分块，每块附带 project_id + speaker + timestamp
2. 摘要文本 —— 整体作为一个文档
3. 笔记内容 —— 按段落分块
4. 附件内容 —— PDF/DOCX 提取文本后分块（使用 pymupdf / python-docx）

**索引流程：**
```
内容变更（新转录/编辑笔记/上传附件）
    ↓ 触发增量索引
    ↓ 文本分块（chunk_size=500, overlap=50）
    ↓ BGE Embedding
    ↓ 写入 LanceDB
```

### 4.2 MCP Server（内嵌于 Python ASR 服务）

**目标：** 在现有 FastAPI 服务中增加 MCP 协议支持，提供知识库检索和统计能力。

**架构：**
```
React Frontend
    ↓ HTTP/SSE
FastAPI (port 18090)
    ├── /asr/*          （现有 ASR 路由）
    ├── /mcp/tools      （MCP 工具列表）
    ├── /mcp/invoke     （MCP 工具调用）
    └── /chat           （问答接口，内部调用 MCP tools）
```

**MCP Tools 定义：**

```python
# Tool 1: 知识库语义检索
search_knowledge_base(query: str, project_ids: list[str] | None, top_k: int = 5)
→ 返回最相关的文本片段 + 来源（项目名、时间、说话人）

# Tool 2: 会议统计
get_meeting_stats(date_range: tuple[str, str] | None)
→ 返回会议数量、总时长、发言人分布、关键词词频

# Tool 3: 行动项汇总
get_action_items(project_ids: list[str] | None, include_done: bool = False)
→ 返回所有待办行动项，按截止日期排序

# Tool 4: 发言人分析
get_speaker_analysis(project_ids: list[str] | None)
→ 返回各发言人发言时长占比、关键观点
```

**问答流程：**
```
用户输入问题
    ↓ POST /chat { question, context: "current_project" | "all" }
    ↓
FastAPI /chat handler:
    1. 判断问题类型（统计类 vs 语义检索类 vs 通用）
    2. 调用对应 MCP Tool 获取上下文
    3. 构造 prompt = 系统提示 + 检索结果 + 用户问题
    4. 调用 LLM（Ollama 或云端）
    5. 返回回答 + 引用来源
    ↓
前端展示回答 + 可点击的来源链接
```

### 4.3 智能问答悬浮按钮

**UI 设计：**
- 页面右下角固定悬浮按钮（圆形，AI 图标）
- 点击展开为聊天面板（400x600px，可拖拽调整大小）
- 两种模式切换：
  - 「当前会议」—— 只检索当前项目的内容
  - 「全部知识库」—— 检索所有会议 + 附件
- 聊天记录按会话保留（内存中，不持久化）
- 回答中的来源链接可跳转到对应会议/转录位置

---

## 五、Phase 3：效率集成（3-4 周）

### 5.1 飞书日历 + 飞书会议（优先）

**OAuth 接入：**
- 注册飞书开放平台应用
- OAuth 2.0 授权（`calendar:calendar:readonly` + `meeting:meeting:readonly`）
- Access Token 存入 SQLite settings

**功能：**
1. **日历同步：** 拉取飞书日历事件，在 OpenMeet 侧边栏展示日历视图
2. **会议关联：** 飞书会议事件自动与 OpenMeet 项目关联
3. **一键录制：** 从日历事件直接启动录制
4. **会后推送：** 转录完成后可一键推送摘要到飞书群聊/文档

**日历 UI：**
- 侧边栏新增「日历」视图切换（与项目树并列）
- 周视图 / 日视图
- 事件卡片显示：时间、标题、参会人、关联项目状态

### 5.2 Google Calendar + Google Meet

**OAuth 接入：**
- Google Cloud Console 注册应用
- OAuth 2.0（`calendar.readonly` + `calendar.events`）
- 流程与飞书类似

### 5.3 腾讯会议

- 腾讯会议开放 API 接入
- 优先级最低，放到需求量大时再做

### 5.4 日历模块抽象

```typescript
interface CalendarProvider {
  id: string;                                    // "feishu" | "google" | "tencent"
  authorize(): Promise<void>;                    // OAuth 流程
  fetchEvents(range: DateRange): Promise<CalendarEvent[]>;
  getEventDetail(eventId: string): Promise<CalendarEventDetail>;
}

interface CalendarEvent {
  id: string;
  title: string;
  startTime: string;
  endTime: string;
  attendees: string[];
  meetingUrl?: string;
  provider: string;
}
```

通过 Provider 抽象层，新增日历平台只需实现接口，不改动 UI 层。

---

## 六、Phase 4：商业化（2-3 周）

### 6.1 用户系统

**技术方案：Casdoor（开源自托管）**

- Go 语言编写，轻量高效
- 原生支持：微信、GitHub、Google、手机号、邮箱密码
- 提供 REST API + SDK
- 自托管，数据完全可控

**部署方案：**
- 初期：托管在云服务器（1 台轻量 VPS 即可）
- Casdoor 提供登录页面 + Token 签发
- OpenMeet 客户端通过 OAuth 流程获取 JWT Token
- Token 存本地，用于付费功能校验

**登录流程：**
```
OpenMeet App → 打开系统浏览器 → Casdoor 登录页（微信扫码/邮箱）
    ↓ OAuth callback
    ↓ 获取 JWT Token
    ↓ 存入本地 Keychain/Credential Store
    ↓ 付费功能根据 Token 中的 plan 字段判断权限
```

### 6.2 License 验证与防破解

**方案：JWT + 服务器校验**

```
付费用户 → Casdoor 用户属性标记 plan: "pro" / "free"
    ↓
客户端启动 → 请求验证服务器签发 License Token（JWT，7 天有效）
    ↓
Token 含：user_id, plan, features[], expires_at, signature
    ↓
客户端本地缓存 Token，离线可用 7 天
    ↓
过期后需联网刷新
```

**防破解措施：**
1. **JWT 签名验证** —— 公钥内嵌客户端，私钥在服务器，无法伪造
2. **设备指纹绑定** —— Token 绑定设备 ID，防止共享
3. **功能代码分离** —— 付费功能的核心逻辑在服务器端（如云同步 API）
4. **混淆** —— Tauri Rust 层做 License 校验，比 JS 更难破解
5. **宽容策略** —— 不做过度防护，重点防止大规模盗版而非个别破解

### 6.3 商业模式：免费 + 增值

**核心理念：** 平台不消耗 AI 算力，收费点在「平台增值功能」。

| 功能 | Free | Pro (个人) | Team |
|------|------|-----------|------|
| **会议录制 + 转录** | ✅ 无限 | ✅ | ✅ |
| **AI 摘要** | ✅ | ✅ | ✅ |
| **文件夹管理** | ✅ | ✅ | ✅ |
| **笔记 + 附件** | ✅ | ✅ | ✅ |
| **导出 (MD/TXT)** | ✅ | ✅ | ✅ |
| **知识库问答** | 3次/天 | ✅ 无限 | ✅ |
| **日历集成** | ❌ | ✅ | ✅ |
| **高级导出 (DOCX/PDF)** | ❌ | ✅ | ✅ |
| **云端同步** | ❌ | ✅ | ✅ |
| **团队共享空间** | ❌ | ❌ | ✅ |
| **多人协作编辑** | ❌ | ❌ | ✅ |
| **管理后台** | ❌ | ❌ | ✅ |

**定价建议：**
- **Free：** 永久免费，核心功能完整
- **Pro：** ¥12/月 或 ¥99/年（个人增值功能）
- **Team：** ¥29/人/月（团队协作功能）

**收费逻辑：**
- 免费版已经足够好用 → 用户量增长
- 知识库按次限制 → 体验后付费转化
- 日历集成是效率刚需 → 付费驱动力
- 云同步解决多设备痛点 → Pro 核心卖点
- 团队版解决协作痛点 → 后期企业收入

---

## 七、技术架构总览

```
┌────────────────────────────────────────────────────────────────┐
│                    OpenMeet v2 Architecture                     │
│                                                                │
│  ┌──────────┐   IPC    ┌────────────┐   HTTP    ┌───────────┐ │
│  │  React   │ ◄──────► │   Tauri    │ ◄───────► │  Casdoor  │ │
│  │ Frontend │          │   (Rust)   │           │  (Auth)   │ │
│  └────┬─────┘          └──┬───┬─────┘           └───────────┘ │
│       │                   │   │                               │
│       │ HTTP/WS           │   │ SQLite                        │
│       ▼                   │   ▼                               │
│  ┌──────────────┐         │  ┌──────────┐                     │
│  │ Python ASR   │         │  │ openmeet │                     │
│  │   Service    │         │  │   .db    │                     │
│  │  (FastAPI)   │         │  └──────────┘                     │
│  │              │         │                                   │
│  │ ├─ ASR 引擎  │         │  ┌──────────┐                     │
│  │ ├─ MCP Tools │         │  │ lance/   │                     │
│  │ ├─ LanceDB  │─────────┘  │ (向量库)  │                     │
│  │ ├─ BGE Emb  │             └──────────┘                     │
│  │ └─ LLM Call │                                              │
│  └──────────────┘                                             │
│                                                                │
│  ┌──────────────┐                                              │
│  │   Ollama     │  ← LLM 推理（本地）                          │
│  └──────────────┘                                              │
└────────────────────────────────────────────────────────────────┘
```

---

## 八、开发路线图

### Phase 1: 数据基座（第 1-3 周）

| 周 | 任务 | 产出 |
|----|------|------|
| W1 | Rust SQLite 集成 + 数据迁移（localStorage → SQLite） | 数据持久化 |
| W1 | 附件管理后端（Rust 文件复制 + SQLite CRUD） | 附件存储 |
| W2 | 笔记页签 UI + 自动保存 | 笔记功能 |
| W2 | 附件页签 UI（拖拽上传 + 列表管理） | 附件功能 |
| W3 | Workspace 页签重构（转录/摘要/笔记/附件） | UI 整合 |
| W3 | 数据完整性测试 + 边界情况处理 | 质量保障 |

### Phase 2: 知识平台（第 4-7 周）

| 周 | 任务 | 产出 |
|----|------|------|
| W4 | Python 向量索引模块（BGE + LanceDB + 文本分块） | 索引引擎 |
| W4 | 文档解析（PDF/DOCX 文本提取） | 附件索引 |
| W5 | MCP Tools 实现（search、stats、action_items、speaker） | 知识检索 |
| W5 | /chat 问答接口（RAG pipeline） | 问答后端 |
| W6 | 悬浮问答按钮 UI + 聊天面板 | 问答前端 |
| W6 | 来源引用 + 跳转链接 | 交互完善 |
| W7 | 增量索引 + 索引管理 + 性能优化 | 生产就绪 |

### Phase 3: 效率集成（第 8-11 周）

| 周 | 任务 | 产出 |
|----|------|------|
| W8 | CalendarProvider 抽象层 + 日历 UI 框架 | 日历基座 |
| W9 | 飞书 OAuth + 日历事件同步 | 飞书日历 |
| W10 | 飞书会议关联 + 一键录制 + 摘要推送 | 飞书集成 |
| W11 | Google Calendar + Google Meet（复用抽象层） | Google 集成 |

### Phase 4: 商业化（第 12-14 周）

| 周 | 任务 | 产出 |
|----|------|------|
| W12 | Casdoor 部署 + 微信/邮箱登录 + 客户端 OAuth 流程 | 用户系统 |
| W13 | License JWT 签发 + Rust 端校验 + 功能门控 | 付费体系 |
| W14 | 付费页面 + 支付集成（微信支付/支付宝） + 落地页 | 商业上线 |

---

## 九、风险与决策记录

| 风险 | 影响 | 缓解措施 |
|------|------|---------|
| BGE 模型体积增加安装包大小 | 用户下载变慢 | 首次使用时按需下载，不打包 |
| 飞书/Google OAuth 审核周期长 | 集成延迟 | 提前申请，Phase 2 期间并行审核 |
| 本地 LLM 推理慢影响问答体验 | 用户等待 | 流式输出 + 支持云端 LLM 降级 |
| 防破解被绕过 | 收入损失 | 核心付费功能（云同步）依赖服务端，无法本地绕过 |
| LanceDB 版本升级不兼容 | 数据迁移 | 锁定版本，重大升级时提供迁移脚本 |

---

## 十、验收标准

### Phase 1
- [ ] 应用重启后数据不丢失（SQLite 持久化）
- [ ] 每个会议可上传/删除附件，元数据正确显示
- [ ] 笔记编辑自动保存，切换项目后内容正确加载
- [ ] Workspace 4 个页签流畅切换

### Phase 2
- [ ] 输入「上次产品评审讨论了什么」能从历史会议中检索到相关内容
- [ ] 统计问题「本月开了几次会」返回准确数字
- [ ] 回答包含来源链接，点击跳转到对应会议/转录位置
- [ ] 知识库索引在新转录完成后 30s 内自动更新

### Phase 3
- [ ] 飞书日历事件正确显示在侧边栏日历视图
- [ ] 从日历事件一键启动录制，会议自动关联
- [ ] 转录完成后可一键推送摘要到飞书

### Phase 4
- [ ] 微信扫码登录成功，Token 正确签发
- [ ] 免费用户知识库问答限制 3 次/天，Pro 用户无限制
- [ ] 离线 7 天后提示联网验证
- [ ] 支付流程完整可用
