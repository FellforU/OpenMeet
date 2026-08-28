# Phase 1: 数据基座 实施计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 将 OpenMeet 从 localStorage 迁移到 SQLite，并新增附件管理和笔记功能，为后续知识库和商业化打下数据基础。

**Architecture:** Rust 端新增 `database.rs` 模块封装 rusqlite 操作，通过 Tauri IPC Command 暴露 CRUD 接口。前端 Zustand store 去掉 persist middleware，改为调用 Tauri invoke。Workspace 新增笔记和附件两个页签。

**Tech Stack:** rusqlite (Rust SQLite)、Tauri IPC、React、Zustand、shadcn/ui Tabs

**设计文档：** `docs/plans/2026-02-26-openmeet-v2-product-design.md`

---

## 前置知识

**关键文件清单：**

| 文件 | 作用 | 行数 |
|------|------|------|
| `src-tauri/src/lib.rs` | Tauri 入口，注册所有 IPC 命令 | ~34 |
| `src-tauri/Cargo.toml` | Rust 依赖 | ~26 |
| `src/stores/projectStore.ts` | 项目/文件夹 CRUD + localStorage persist | ~174 |
| `src/stores/settingsStore.ts` | 设置 + localStorage persist | ~80 |
| `src/stores/transcriptionStore.ts` | 转录段落/摘要（内存，无持久化） | ~210 |
| `src/types/index.ts` | TypeScript 类型定义 | ~47 |
| `src/components/Workspace/index.tsx` | 工作区页签（转录/摘要） | ~40 |
| `src/App.tsx` | 应用根组件 | ~101 |

**当前持久化方式：** Zustand persist → localStorage
- `openmeet-projects`：所有项目/文件夹
- `openmeet-settings`：全局设置
- `openmeet_first_run_done`：首次运行标志
- `openmeet_language`：语言设置

**当前未持久化但需要持久化的数据：**
- 转录段落 (segments) —— 目前关闭应用即丢失
- 摘要 (summary) —— 目前关闭应用即丢失

---

## Task 1: Rust SQLite 模块

**Files:**
- Add dep: `src-tauri/Cargo.toml`
- Create: `src-tauri/src/database.rs`
- Modify: `src-tauri/src/lib.rs`

### Step 1: 添加 rusqlite 依赖

在 `src-tauri/Cargo.toml` 的 `[dependencies]` 末尾添加：

```toml
rusqlite = { version = "0.32", features = ["bundled"] }
```

`bundled` feature 自带 SQLite 编译，用户无需安装系统 SQLite。

### Step 2: 创建 database.rs 模块

创建 `src-tauri/src/database.rs`，包含：

1. `Database` 结构体，封装 `rusqlite::Connection`
2. `init()` 方法 —— 创建所有表（含 IF NOT EXISTS）
3. `DatabaseState` 类型 —— 用于 Tauri managed state

**表结构（完整 SQL）：**

```sql
CREATE TABLE IF NOT EXISTS projects (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  parent_id   TEXT REFERENCES projects(id) ON DELETE CASCADE,
  is_folder   INTEGER NOT NULL DEFAULT 0,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  audio_path  TEXT,
  duration_ms INTEGER,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS segments (
  id         TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  idx        INTEGER NOT NULL,
  start_time REAL NOT NULL,
  end_time   REAL NOT NULL,
  text       TEXT NOT NULL,
  speaker    TEXT,
  confidence REAL
);

CREATE TABLE IF NOT EXISTS summaries (
  id              TEXT PRIMARY KEY,
  project_id      TEXT UNIQUE NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  topic           TEXT,
  conclusions     TEXT,
  action_items    TEXT,
  discussion      TEXT,
  raw_markdown    TEXT,
  edited_markdown TEXT
);

CREATE TABLE IF NOT EXISTS attachments (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  filename    TEXT NOT NULL,
  file_path   TEXT NOT NULL,
  file_size   INTEGER NOT NULL,
  mime_type   TEXT NOT NULL,
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS notes (
  id         TEXT PRIMARY KEY,
  project_id TEXT UNIQUE NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  content    TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
```

**Rust 代码要点：**
- `Database` 内部持有 `Connection` 并 wrap in `Mutex<Connection>`
- `init()` 执行 `PRAGMA journal_mode=WAL;` + `PRAGMA foreign_keys=ON;` + 所有 CREATE TABLE
- 数据库文件路径：从 `AppHandle.path().app_data_dir()` 获取，存为 `openmeet.db`

### Step 3: 注册 DatabaseState 到 Tauri

在 `src-tauri/src/lib.rs` 中：
1. `mod database;`
2. 在 `.setup()` 回调中初始化数据库：
   ```rust
   let db_path = app.path().app_data_dir().unwrap().join("openmeet.db");
   std::fs::create_dir_all(db_path.parent().unwrap()).ok();
   let db = database::Database::new(&db_path)?;
   app.manage(database::DatabaseState::new(db));
   ```
3. 将新的 IPC 命令注册到 `invoke_handler`

### Step 4: cargo check 验证

```bash
cd src-tauri && cargo check
```

Expected: 编译成功，无错误。

### Step 5: Commit

```bash
git add src-tauri/Cargo.toml src-tauri/src/database.rs src-tauri/src/lib.rs
git commit -m "feat(db): add SQLite database module with schema initialization"
```

---

## Task 2: 项目 CRUD IPC 命令

**Files:**
- Modify: `src-tauri/src/database.rs` —— 添加项目 CRUD 方法
- Modify: `src-tauri/src/lib.rs` —— 注册新命令

### Step 1: 实现 Rust 项目 CRUD

在 `database.rs` 中添加以下 Tauri commands：

```rust
#[tauri::command]
fn db_get_all_projects(state: State<DatabaseState>) -> Result<Vec<Project>, String>

#[tauri::command]
fn db_add_project(state: State<DatabaseState>, project: Project) -> Result<(), String>

#[tauri::command]
fn db_update_project(state: State<DatabaseState>, id: String, updates: ProjectUpdate) -> Result<(), String>

#[tauri::command]
fn db_delete_project(state: State<DatabaseState>, id: String) -> Result<(), String>

#[tauri::command]
fn db_reorder_projects(state: State<DatabaseState>, parent_id: Option<String>, ordered_ids: Vec<String>) -> Result<(), String>
```

**Rust 数据结构（serde Serialize/Deserialize）：**
```rust
#[derive(Serialize, Deserialize, Clone)]
pub struct Project {
    pub id: String,
    pub title: String,
    pub parent_id: Option<String>,
    pub is_folder: bool,
    pub sort_order: i32,
    pub audio_path: Option<String>,
    pub duration_ms: Option<i64>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Deserialize)]
pub struct ProjectUpdate {
    pub title: Option<String>,
    pub parent_id: Option<Option<String>>,  // Some(None) = move to root
    pub audio_path: Option<String>,
    pub duration_ms: Option<i64>,
    pub sort_order: Option<i32>,
}
```

**db_delete_project 要点：**
- 由于 `ON DELETE CASCADE`，删除文件夹会自动删除子项
- 同时需要删除关联的附件文件（磁盘文件），通过先查询 attachments 表获取 file_path 列表，删除磁盘文件，再删除数据库记录

### Step 2: 注册命令到 lib.rs

在 `invoke_handler` 的 `generate_handler![]` 中添加所有新命令。

### Step 3: cargo check 验证

```bash
cd src-tauri && cargo check
```

### Step 4: Commit

```bash
git add src-tauri/src/database.rs src-tauri/src/lib.rs
git commit -m "feat(db): add project CRUD IPC commands"
```

---

## Task 3: 转录/摘要持久化 IPC 命令

**Files:**
- Modify: `src-tauri/src/database.rs`
- Modify: `src-tauri/src/lib.rs`

### Step 1: 实现转录/摘要 CRUD

```rust
// Segments
#[tauri::command]
fn db_get_segments(state: State<DatabaseState>, project_id: String) -> Result<Vec<Segment>, String>

#[tauri::command]
fn db_save_segments(state: State<DatabaseState>, project_id: String, segments: Vec<Segment>) -> Result<(), String>
// 实现：DELETE WHERE project_id = ? 然后批量 INSERT

// Summary
#[tauri::command]
fn db_get_summary(state: State<DatabaseState>, project_id: String) -> Result<Option<Summary>, String>

#[tauri::command]
fn db_save_summary(state: State<DatabaseState>, project_id: String, summary: Summary) -> Result<(), String>
// 实现：INSERT OR REPLACE
```

**Rust 数据结构：**
```rust
#[derive(Serialize, Deserialize, Clone)]
pub struct Segment {
    pub id: String,
    pub start: f64,
    pub end: f64,
    pub text: String,
    pub speaker: Option<String>,
    pub confidence: Option<f64>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct Summary {
    pub topic: String,
    pub conclusions: Vec<String>,           // 存为 JSON TEXT
    pub action_items: Vec<ActionItem>,      // 存为 JSON TEXT
    pub discussion: Vec<DiscussionItem>,    // 存为 JSON TEXT
    pub raw_markdown: String,
    pub edited_markdown: Option<String>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct ActionItem {
    pub assignee: String,
    pub task: String,
    pub deadline: Option<String>,
    pub done: Option<bool>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct DiscussionItem {
    pub topic: String,
    pub summary: String,
}
```

**存储策略：**
- `conclusions`、`action_items`、`discussion` 字段存为 JSON TEXT（`serde_json::to_string`）
- 读取时反序列化（`serde_json::from_str`）

### Step 2: cargo check

### Step 3: Commit

```bash
git commit -m "feat(db): add segment and summary persistence IPC commands"
```

---

## Task 4: 附件和笔记 IPC 命令

**Files:**
- Modify: `src-tauri/src/database.rs`
- Modify: `src-tauri/src/lib.rs`

### Step 1: 实现附件 CRUD

```rust
#[tauri::command]
fn db_get_attachments(state: State<DatabaseState>, project_id: String) -> Result<Vec<Attachment>, String>

#[tauri::command]
fn db_add_attachment(app: AppHandle, state: State<DatabaseState>, project_id: String, source_path: String) -> Result<Attachment, String>
// 实现：
// 1. 读取源文件元信息（大小、MIME 类型）
// 2. 复制到 {app_data}/attachments/{project_id}/{filename}
// 3. INSERT 到 attachments 表
// 4. 返回 Attachment 对象

#[tauri::command]
fn db_delete_attachment(state: State<DatabaseState>, id: String) -> Result<(), String>
// 实现：先查询 file_path，删除磁盘文件，再 DELETE FROM attachments

#[tauri::command]
fn db_open_attachment(id: String) -> Result<(), String>
// 实现：使用 open::that() 打开文件（需添加 open crate 依赖）
```

**Rust 数据结构：**
```rust
#[derive(Serialize, Deserialize, Clone)]
pub struct Attachment {
    pub id: String,
    pub project_id: String,
    pub filename: String,
    pub file_path: String,
    pub file_size: i64,
    pub mime_type: String,
    pub created_at: String,
}
```

**MIME 类型检测：** 根据文件扩展名映射（内置一个简单的 match 函数，覆盖 pdf/docx/txt/md/pptx/xlsx/png/jpg/gif/webp/svg）。

### Step 2: 实现笔记 CRUD

```rust
#[tauri::command]
fn db_get_note(state: State<DatabaseState>, project_id: String) -> Result<Option<Note>, String>

#[tauri::command]
fn db_save_note(state: State<DatabaseState>, project_id: String, content: String) -> Result<(), String>
// 实现：INSERT OR REPLACE（upsert）
```

```rust
#[derive(Serialize, Deserialize, Clone)]
pub struct Note {
    pub id: String,
    pub project_id: String,
    pub content: String,
    pub updated_at: String,
}
```

### Step 3: 实现设置 KV 存取

```rust
#[tauri::command]
fn db_get_setting(state: State<DatabaseState>, key: String) -> Result<Option<String>, String>

#[tauri::command]
fn db_set_setting(state: State<DatabaseState>, key: String, value: String) -> Result<(), String>
```

### Step 4: 添加 `open` crate 依赖

`Cargo.toml`:
```toml
open = "5"
```

### Step 5: cargo check + Commit

```bash
git commit -m "feat(db): add attachment, note, and settings IPC commands"
```

---

## Task 5: 数据迁移（localStorage → SQLite）

**Files:**
- Create: `src/services/dataMigration.ts`
- Modify: `src/App.tsx`

### Step 1: 创建迁移服务

`src/services/dataMigration.ts`:

```typescript
import { invoke } from "@tauri-apps/api/core";

interface LegacyProject { /* 现有 Project 类型 */ }

export async function migrateFromLocalStorage(): Promise<boolean> {
  // 检查是否已迁移
  const migrated = await invoke<string | null>("db_get_setting", { key: "migrated_from_localstorage" });
  if (migrated === "true") return false;

  // 迁移项目数据
  const projectsRaw = localStorage.getItem("openmeet-projects");
  if (projectsRaw) {
    try {
      const parsed = JSON.parse(projectsRaw);
      const projects: LegacyProject[] = parsed.state?.projects || [];
      for (const p of projects) {
        await invoke("db_add_project", { project: {
          id: p.id,
          title: p.title,
          parent_id: p.parentId || null,
          is_folder: p.isFolder || false,
          sort_order: p.sortOrder || 0,
          audio_path: p.audioPath || null,
          duration_ms: p.durationMs || null,
          created_at: p.createdAt,
          updated_at: p.updatedAt,
        }});
      }
    } catch (e) {
      console.error("Failed to migrate projects:", e);
    }
  }

  // 迁移设置
  const settingsRaw = localStorage.getItem("openmeet-settings");
  if (settingsRaw) {
    try {
      const parsed = JSON.parse(settingsRaw);
      await invoke("db_set_setting", { key: "settings", value: JSON.stringify(parsed.state) });
    } catch (e) {
      console.error("Failed to migrate settings:", e);
    }
  }

  // 迁移首次运行标志
  const firstRun = localStorage.getItem("openmeet_first_run_done");
  if (firstRun) {
    await invoke("db_set_setting", { key: "first_run_done", value: firstRun });
  }

  // 迁移语言设置
  const lang = localStorage.getItem("openmeet_language");
  if (lang) {
    await invoke("db_set_setting", { key: "language", value: lang });
  }

  // 标记迁移完成
  await invoke("db_set_setting", { key: "migrated_from_localstorage", value: "true" });

  return true;
}
```

### Step 2: 在 App.tsx 启动时调用迁移

在 `App.tsx` 的 `useEffect` 初始化逻辑中，ASR 服务启动之前调用：

```typescript
import { migrateFromLocalStorage } from "./services/dataMigration";

// 在 useEffect 开头
await migrateFromLocalStorage();
```

### Step 3: tsc 验证 + Commit

```bash
npx tsc --noEmit
git commit -m "feat(db): add localStorage to SQLite data migration"
```

---

## Task 6: 重写 projectStore（SQLite 后端）

**Files:**
- Rewrite: `src/stores/projectStore.ts`

### Step 1: 去掉 persist middleware

将 `create<ProjectStore>()(persist(...))` 改为 `create<ProjectStore>(...)`.

### Step 2: 所有操作改为 invoke 调用

**核心变更模式：**

```typescript
// Before (localStorage):
addProject: (title, parentId) => {
  const project = { id: generateId(), title, ... };
  set({ projects: [...get().projects, project] });
}

// After (SQLite):
addProject: async (title, parentId) => {
  const project = { id: generateId(), title, ... };
  await invoke("db_add_project", { project: mapToRust(project) });
  set({ projects: [...get().projects, project] });
  return project;
}
```

**需要改为 async 的方法：**
- `addProject` → async，先 invoke 再更新内存
- `addFolder` → async
- `updateProject` → async
- `deleteProject` → async
- `moveItem` → async
- `reorder` → async

**新增方法：**
- `loadProjects` → 启动时调用 `invoke("db_get_all_projects")`，加载到内存
- 内部工具方法 `getItemDepth`、`getDescendantIds`、`getMaxSortOrder` 保持纯内存计算不变

**字段名映射：**
TypeScript 使用 camelCase，Rust 使用 snake_case。需要在 invoke 时转换：
```typescript
function mapToRust(p: Project) {
  return {
    id: p.id,
    title: p.title,
    parent_id: p.parentId,
    is_folder: p.isFolder,
    sort_order: p.sortOrder,
    audio_path: p.audioPath,
    duration_ms: p.durationMs,
    created_at: p.createdAt,
    updated_at: p.updatedAt,
  };
}

function mapFromRust(r: any): Project {
  return {
    id: r.id,
    title: r.title,
    parentId: r.parent_id,
    isFolder: r.is_folder,
    sortOrder: r.sort_order,
    audioPath: r.audio_path,
    durationMs: r.duration_ms,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}
```

### Step 3: tsc 验证

所有调用 `addProject`/`addFolder` 的地方需要加 `await`（它们现在是 async）。影响文件：
- `src/components/Sidebar/index.tsx`
- `src/components/Sidebar/ProjectList.tsx`
- `src/stores/recordingStore.ts`（自动创建会议）

### Step 4: Commit

```bash
git commit -m "refactor(store): migrate projectStore from localStorage to SQLite"
```

---

## Task 7: 重写 settingsStore + transcriptionStore（SQLite 后端）

**Files:**
- Rewrite: `src/stores/settingsStore.ts`
- Modify: `src/stores/transcriptionStore.ts`

### Step 1: settingsStore 改为 SQLite

- 去掉 `persist` middleware
- 新增 `loadSettings()` —— 启动时从 SQLite 加载
- 所有 `set*` 方法改为 async，先 invoke `db_set_setting` 再更新内存
- settings 存为一个 JSON value（key = `"settings"`）

### Step 2: transcriptionStore 添加持久化

当前 transcriptionStore 的 segments 和 summary 不持久化。改为：

- `setSegments(segments)` 后调用 `invoke("db_save_segments", { projectId, segments })`
- `setSummary(summary)` 后调用 `invoke("db_save_summary", { projectId, summary })`
- 新增 `loadProjectData(projectId)` —— 从 SQLite 加载 segments + summary

**触发时机：** 在 projectStore 的 `setActiveProject(id)` 中调用 `transcriptionStore.loadProjectData(id)`

### Step 3: App.tsx 启动加载

在 `App.tsx` 初始化流程中：
```typescript
await migrateFromLocalStorage();
await useProjectStore.getState().loadProjects();
await useSettingsStore.getState().loadSettings();
```

### Step 4: 更新 App.tsx 首次运行检查

从 localStorage 改为 SQLite：
```typescript
// Before:
const done = localStorage.getItem("openmeet_first_run_done");

// After:
const done = await invoke<string | null>("db_get_setting", { key: "first_run_done" });
```

### Step 5: tsc 验证 + Commit

```bash
git commit -m "refactor(store): migrate settings and transcription stores to SQLite"
```

---

## Task 8: 附件页签 UI

**Files:**
- Create: `src/components/Workspace/AttachmentsPanel.tsx`
- Modify: `src/components/Workspace/index.tsx`
- Modify: `src/i18n/locales/zh/workspace.json`
- Modify: `src/i18n/locales/en/workspace.json`

### Step 1: 创建 AttachmentsPanel 组件

**功能：**
- 顶部：「添加附件」按钮（触发文件选择器），支持拖拽上传
- 列表：文件图标 + 文件名 + 大小 + 上传时间
- 每项：右侧操作按钮（打开、删除）
- 空状态：提示文案 + 上传按钮

**组件结构：**
```tsx
function AttachmentsPanel({ projectId }: { projectId: string }) {
  const [attachments, setAttachments] = useState<Attachment[]>([]);

  // 加载附件列表
  useEffect(() => {
    invoke("db_get_attachments", { projectId }).then(setAttachments);
  }, [projectId]);

  // 上传处理
  const handleUpload = async (files: FileList) => {
    for (const file of files) {
      const path = (file as any).path;  // Tauri 提供磁盘路径
      if (!path) continue;
      const att = await invoke<Attachment>("db_add_attachment", {
        projectId, sourcePath: path,
      });
      setAttachments((prev) => [...prev, att]);
    }
  };

  // 删除处理
  const handleDelete = async (id: string) => {
    await invoke("db_delete_attachment", { id });
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  };

  // 打开文件
  const handleOpen = (id: string) => invoke("db_open_attachment", { id });
}
```

**文件大小格式化：**
```typescript
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
```

**MIME 图标映射：** 使用 Lucide 图标
- PDF → `FileText`
- 图片 → `Image`
- 文档 → `FileText`
- 其他 → `File`

### Step 2: 修改 Workspace 添加附件页签

在 `src/components/Workspace/index.tsx` 中新增 `attachments` TabsTrigger + TabsContent：

```tsx
<TabsTrigger value="attachments" className="gap-1.5">
  <Paperclip className="h-3.5 w-3.5" />
  {t("tabs.attachments")}
</TabsTrigger>
```

### Step 3: i18n 翻译

`workspace.json` 新增：
```json
"tabs.attachments": "附件",
"attachments.empty": "暂无附件",
"attachments.add": "添加附件",
"attachments.dragHint": "拖拽文件到此处",
"attachments.deleteConfirm": "确定要删除这个附件吗？",
"attachments.open": "打开文件"
```

### Step 4: tsc 验证 + Commit

```bash
git commit -m "feat(ui): add attachments panel with upload, delete, and open"
```

---

## Task 9: 笔记页签 UI

**Files:**
- Create: `src/components/Workspace/NotesPanel.tsx`
- Modify: `src/components/Workspace/index.tsx`
- Modify: `src/i18n/locales/zh/workspace.json`
- Modify: `src/i18n/locales/en/workspace.json`

### Step 1: 创建 NotesPanel 组件

**功能：**
- 全高度 Textarea，monospace 字体，Markdown 友好
- 自动保存（debounce 1 秒）
- 切换项目时自动加载对应笔记
- 保存状态指示（「已保存」/「保存中...」）

**组件结构：**
```tsx
function NotesPanel({ projectId }: { projectId: string }) {
  const [content, setContent] = useState("");
  const [saveStatus, setSaveStatus] = useState<"saved" | "saving" | "idle">("idle");

  // 加载笔记
  useEffect(() => {
    invoke<Note | null>("db_get_note", { projectId }).then((note) => {
      setContent(note?.content || "");
      setSaveStatus("idle");
    });
  }, [projectId]);

  // 自动保存（debounce 1s）
  useEffect(() => {
    if (saveStatus !== "saving") return;
    const timer = setTimeout(async () => {
      await invoke("db_save_note", { projectId, content });
      setSaveStatus("saved");
    }, 1000);
    return () => clearTimeout(timer);
  }, [content, projectId, saveStatus]);

  const handleChange = (value: string) => {
    setContent(value);
    setSaveStatus("saving");
  };
}
```

**UI：**
- 右上角小字显示保存状态
- Textarea 占满剩余空间：`className="flex-1 resize-none font-mono text-sm"`
- 空状态时 placeholder：`"在这里记录会议笔记..."`

### Step 2: 修改 Workspace 添加笔记页签

```tsx
<TabsTrigger value="notes" className="gap-1.5">
  <NotebookPen className="h-3.5 w-3.5" />
  {t("tabs.notes")}
</TabsTrigger>
```

**最终页签顺序：** 转录 → 摘要 → 笔记 → 附件

### Step 3: i18n 翻译

```json
"tabs.notes": "笔记",
"notes.placeholder": "在这里记录会议笔记...",
"notes.saved": "已保存",
"notes.saving": "保存中..."
```

### Step 4: tsc 验证 + Commit

```bash
git commit -m "feat(ui): add notes panel with auto-save"
```

---

## Task 10: 集成测试与清理

**Files:**
- Modify: `src/App.tsx` —— 清理旧 localStorage 引用
- Modify: `src/i18n/index.ts` —— 语言设置改用 SQLite
- 各 store 文件 —— 确保所有路径可用

### Step 1: 清理 localStorage 残留

在 `App.tsx` 中：
- 首次运行检查改为 `invoke("db_get_setting")`
- 设置首次运行标志改为 `invoke("db_set_setting")`

在 `src/i18n/index.ts` 中：
- 语言加载可暂时保留 localStorage（i18next 内部管理），后续迁移

### Step 2: 全量编译验证

```bash
npx tsc --noEmit
cd src-tauri && cargo check
```

### Step 3: 手动测试清单

- [ ] 启动应用，数据库文件创建成功
- [ ] 旧数据从 localStorage 正确迁移到 SQLite
- [ ] 新建项目/文件夹，重启应用后仍存在
- [ ] 录制 → 停止 → 转录内容持久化
- [ ] 切换项目时，转录和摘要正确加载
- [ ] 上传附件成功，文件复制到 attachments 目录
- [ ] 删除附件，磁盘文件同步清除
- [ ] 笔记编辑后自动保存，切换项目后重新加载
- [ ] 设置修改后重启应用仍保留
- [ ] 删除文件夹时，子项目及其附件/笔记级联删除

### Step 4: Final Commit

```bash
git commit -m "refactor: complete localStorage to SQLite migration, add notes and attachments"
```

---

## 文件变更总览

| 操作 | 文件 | 说明 |
|------|------|------|
| **创建** | `src-tauri/src/database.rs` | SQLite 封装 + 所有 IPC 命令 |
| **创建** | `src/services/dataMigration.ts` | localStorage → SQLite 迁移逻辑 |
| **创建** | `src/components/Workspace/AttachmentsPanel.tsx` | 附件管理页签 |
| **创建** | `src/components/Workspace/NotesPanel.tsx` | 笔记编辑页签 |
| **修改** | `src-tauri/Cargo.toml` | 添加 rusqlite、open 依赖 |
| **修改** | `src-tauri/src/lib.rs` | 注册数据库命令、初始化 DB |
| **重写** | `src/stores/projectStore.ts` | 去掉 persist，改为 invoke |
| **重写** | `src/stores/settingsStore.ts` | 去掉 persist，改为 invoke |
| **修改** | `src/stores/transcriptionStore.ts` | 添加 loadProjectData、持久化 |
| **修改** | `src/components/Workspace/index.tsx` | 添加笔记和附件页签 |
| **修改** | `src/App.tsx` | 启动迁移 + 数据加载 |
| **修改** | `src/i18n/locales/{zh,en}/workspace.json` | 新增翻译键 |

---

## 依赖变更

**Rust (Cargo.toml):**
```toml
rusqlite = { version = "0.32", features = ["bundled"] }
open = "5"
```

**前端 (package.json):**
无新增依赖（使用现有 shadcn/ui 组件）。
