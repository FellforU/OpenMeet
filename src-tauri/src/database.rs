use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::sync::Mutex;
use tauri::{AppHandle, Manager, State};

// ---------------------------------------------------------------------------
// Database wrapper
// ---------------------------------------------------------------------------

pub struct Database {
    conn: Mutex<Connection>,
}

pub type DatabaseState = Database;

impl Database {
    pub fn new(path: &Path) -> Result<Self, String> {
        let conn = Connection::open(path).map_err(|e| e.to_string())?;
        let db = Self {
            conn: Mutex::new(conn),
        };
        db.init()?;
        Ok(db)
    }

    fn init(&self) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute_batch("PRAGMA journal_mode=WAL;")
            .map_err(|e| e.to_string())?;
        conn.execute_batch("PRAGMA foreign_keys=ON;")
            .map_err(|e| e.to_string())?;

        conn.execute_batch(
            "
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
                decisions       TEXT,
                technical_details TEXT,
                next_steps      TEXT,
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

            CREATE TABLE IF NOT EXISTS voiceprints (
                id            TEXT PRIMARY KEY,
                name          TEXT NOT NULL DEFAULT '',
                nickname      TEXT DEFAULT '',
                email         TEXT DEFAULT '',
                department    TEXT DEFAULT '',
                title         TEXT DEFAULT '',
                note          TEXT DEFAULT '',
                avatar_path   TEXT,
                embedding     BLOB NOT NULL,
                sample_count  INTEGER NOT NULL DEFAULT 1,
                model_version TEXT NOT NULL DEFAULT '',
                created_at    TEXT NOT NULL,
                updated_at    TEXT NOT NULL,
                last_seen_at  TEXT
            );
            ",
        )
        .map_err(|e| e.to_string())?;

        // Migration: add voiceprint_id column to segments if not exists
        let has_voiceprint_id: bool = conn
            .prepare("SELECT voiceprint_id FROM segments LIMIT 0")
            .is_ok();
        if !has_voiceprint_id {
            conn.execute_batch(
                "ALTER TABLE segments ADD COLUMN voiceprint_id TEXT REFERENCES voiceprints(id);"
            )
            .map_err(|e| e.to_string())?;
        }

        // Migration: add new summary columns (decisions, technical_details, next_steps)
        let has_decisions: bool = conn
            .prepare("SELECT decisions FROM summaries LIMIT 0")
            .is_ok();
        if !has_decisions {
            conn.execute_batch(
                "ALTER TABLE summaries ADD COLUMN decisions TEXT;
                 ALTER TABLE summaries ADD COLUMN technical_details TEXT;
                 ALTER TABLE summaries ADD COLUMN next_steps TEXT;"
            )
            .map_err(|e| e.to_string())?;
        }

        Ok(())
    }
}

// ---------------------------------------------------------------------------
// Data structures
// ---------------------------------------------------------------------------

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
    pub parent_id: Option<Option<String>>,
    pub audio_path: Option<String>,
    pub duration_ms: Option<i64>,
    pub sort_order: Option<i32>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct Segment {
    pub id: String,
    pub start: f64,
    pub end: f64,
    pub text: String,
    pub speaker: Option<String>,
    pub confidence: Option<f64>,
    pub voiceprint_id: Option<String>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct ActionItem {
    pub assignee: String,
    pub task: String,
    pub deadline: Option<String>,
    #[serde(default)]
    pub priority: Option<String>,
    #[serde(default)]
    pub status: Option<String>,
    pub done: Option<bool>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct DiscussionItem {
    pub topic: String,
    pub summary: String,
    #[serde(default)]
    pub participants: Option<Vec<String>>,
    #[serde(default)]
    pub key_points: Option<Vec<String>>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct Decision {
    pub decision: String,
    pub made_by: String,
    pub reasoning: String,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct TechnicalDetail {
    pub category: String,
    pub details: String,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct Summary {
    pub topic: String,
    pub conclusions: Vec<String>,
    #[serde(default)]
    pub decisions: Option<Vec<Decision>>,
    pub action_items: Vec<ActionItem>,
    pub discussion: Vec<DiscussionItem>,
    #[serde(default)]
    pub technical_details: Option<Vec<TechnicalDetail>>,
    #[serde(default)]
    pub next_steps: Option<Vec<String>>,
    #[serde(default)]
    pub key_data: Option<Vec<String>>,
    #[serde(default)]
    pub participants: Option<Vec<String>>,
    pub raw_markdown: String,
    pub edited_markdown: Option<String>,
}

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

#[derive(Serialize, Deserialize, Clone)]
pub struct Note {
    pub id: String,
    pub project_id: String,
    pub content: String,
    pub updated_at: String,
}

// ---------------------------------------------------------------------------
// Helper: MIME type detection
// ---------------------------------------------------------------------------

fn guess_mime_type(filename: &str) -> &'static str {
    let ext = filename.rsplit('.').next().unwrap_or("").to_lowercase();
    match ext.as_str() {
        "pdf" => "application/pdf",
        "doc" | "docx" => "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "xls" | "xlsx" => "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "ppt" | "pptx" => {
            "application/vnd.openxmlformats-officedocument.presentationml.presentation"
        }
        "txt" => "text/plain",
        "md" => "text/markdown",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "wav" => "audio/wav",
        "mp3" => "audio/mpeg",
        "mp4" => "video/mp4",
        "json" => "application/json",
        "csv" => "text/csv",
        _ => "application/octet-stream",
    }
}

// ---------------------------------------------------------------------------
// Project CRUD commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn db_get_all_projects(state: State<DatabaseState>) -> Result<Vec<Project>, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT id, title, parent_id, is_folder, sort_order, audio_path, duration_ms, created_at, updated_at FROM projects ORDER BY sort_order",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([], |row| {
            Ok(Project {
                id: row.get(0)?,
                title: row.get(1)?,
                parent_id: row.get(2)?,
                is_folder: row.get::<_, i32>(3)? != 0,
                sort_order: row.get(4)?,
                audio_path: row.get(5)?,
                duration_ms: row.get(6)?,
                created_at: row.get(7)?,
                updated_at: row.get(8)?,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut projects = Vec::new();
    for row in rows {
        projects.push(row.map_err(|e| e.to_string())?);
    }
    Ok(projects)
}

#[tauri::command]
pub fn db_add_project(state: State<DatabaseState>, project: Project) -> Result<(), String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO projects (id, title, parent_id, is_folder, sort_order, audio_path, duration_ms, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        params![
            project.id,
            project.title,
            project.parent_id,
            project.is_folder as i32,
            project.sort_order,
            project.audio_path,
            project.duration_ms,
            project.created_at,
            project.updated_at,
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn db_update_project(
    state: State<DatabaseState>,
    id: String,
    updates: ProjectUpdate,
) -> Result<(), String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let now = chrono::Utc::now().to_rfc3339();

    // Build dynamic update
    let mut sets = Vec::new();
    let mut values: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();

    if let Some(ref title) = updates.title {
        sets.push("title = ?");
        values.push(Box::new(title.clone()));
    }
    if let Some(ref parent_id) = updates.parent_id {
        sets.push("parent_id = ?");
        values.push(Box::new(parent_id.clone()));
    }
    if let Some(ref audio_path) = updates.audio_path {
        sets.push("audio_path = ?");
        values.push(Box::new(audio_path.clone()));
    }
    if let Some(duration_ms) = updates.duration_ms {
        sets.push("duration_ms = ?");
        values.push(Box::new(duration_ms));
    }
    if let Some(sort_order) = updates.sort_order {
        sets.push("sort_order = ?");
        values.push(Box::new(sort_order));
    }

    if sets.is_empty() {
        return Ok(());
    }

    sets.push("updated_at = ?");
    values.push(Box::new(now));

    let sql = format!("UPDATE projects SET {} WHERE id = ?", sets.join(", "));
    values.push(Box::new(id));

    let params: Vec<&dyn rusqlite::types::ToSql> = values.iter().map(|v| v.as_ref()).collect();
    conn.execute(&sql, params.as_slice())
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn db_delete_project(
    app: AppHandle,
    state: State<DatabaseState>,
    id: String,
) -> Result<(), String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;

    // First, collect attachment file paths for this project and descendants
    let mut stmt = conn
        .prepare(
            "SELECT file_path FROM attachments WHERE project_id IN (
                WITH RECURSIVE descendants(id) AS (
                    SELECT ?1
                    UNION ALL
                    SELECT p.id FROM projects p JOIN descendants d ON p.parent_id = d.id
                )
                SELECT id FROM descendants
            )",
        )
        .map_err(|e| e.to_string())?;

    let paths: Vec<String> = stmt
        .query_map(params![id], |row| row.get(0))
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    // Delete attachment disk files
    for path in &paths {
        let _ = std::fs::remove_file(path);
    }

    // Also clean up attachment directories
    let app_data = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let attachments_dir = app_data.join("attachments").join(&id);
    let _ = std::fs::remove_dir_all(&attachments_dir);

    // Collect and delete audio files for all projects being removed
    let mut audio_stmt = conn
        .prepare(
            "SELECT audio_path FROM projects WHERE id IN (
                WITH RECURSIVE descendants(id) AS (
                    SELECT ?1
                    UNION ALL
                    SELECT p.id FROM projects p JOIN descendants d ON p.parent_id = d.id
                )
                SELECT id FROM descendants
            ) AND audio_path IS NOT NULL",
        )
        .map_err(|e| e.to_string())?;

    let audio_paths: Vec<String> = audio_stmt
        .query_map(params![id], |row| row.get(0))
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    for audio_path in &audio_paths {
        let _ = std::fs::remove_file(audio_path);
        // Clean up empty parent directory (e.g. recordings/)
        if let Some(parent) = std::path::Path::new(audio_path).parent() {
            let _ = std::fs::remove_dir(parent); // only succeeds if empty
        }
    }

    // CASCADE will handle segments, summaries, attachments, notes
    conn.execute("DELETE FROM projects WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn db_reorder_projects(
    state: State<DatabaseState>,
    ordered_ids: Vec<String>,
) -> Result<(), String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let now = chrono::Utc::now().to_rfc3339();
    for (i, id) in ordered_ids.iter().enumerate() {
        conn.execute(
            "UPDATE projects SET sort_order = ?1, updated_at = ?2 WHERE id = ?3",
            params![i as i32, now, id],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Segment CRUD commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn db_get_segments(
    state: State<DatabaseState>,
    project_id: String,
) -> Result<Vec<Segment>, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT id, start_time, end_time, text, speaker, confidence, voiceprint_id FROM segments WHERE project_id = ?1 ORDER BY idx",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map(params![project_id], |row| {
            Ok(Segment {
                id: row.get(0)?,
                start: row.get(1)?,
                end: row.get(2)?,
                text: row.get(3)?,
                speaker: row.get(4)?,
                confidence: row.get(5)?,
                voiceprint_id: row.get(6)?,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut segments = Vec::new();
    for row in rows {
        segments.push(row.map_err(|e| e.to_string())?);
    }
    Ok(segments)
}

#[tauri::command]
pub fn db_save_segments(
    state: State<DatabaseState>,
    project_id: String,
    segments: Vec<Segment>,
) -> Result<(), String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;

    // Use a transaction so DELETE + INSERT are atomic — no data loss on failure
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;

    // Delete existing segments for this project
    tx.execute(
        "DELETE FROM segments WHERE project_id = ?1",
        params![project_id],
    )
    .map_err(|e| e.to_string())?;

    // Batch insert
    for (i, seg) in segments.iter().enumerate() {
        tx.execute(
            "INSERT INTO segments (id, project_id, idx, start_time, end_time, text, speaker, confidence, voiceprint_id)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                seg.id,
                project_id,
                i as i32,
                seg.start,
                seg.end,
                seg.text,
                seg.speaker,
                seg.confidence,
                seg.voiceprint_id,
            ],
        )
        .map_err(|e| e.to_string())?;
    }

    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Summary CRUD commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn db_get_summary(
    state: State<DatabaseState>,
    project_id: String,
) -> Result<Option<Summary>, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT topic, conclusions, action_items, discussion, decisions, technical_details, next_steps, raw_markdown, edited_markdown FROM summaries WHERE project_id = ?1",
        )
        .map_err(|e| e.to_string())?;

    let result = stmt
        .query_row(params![project_id], |row| {
            let topic: String = row.get(0)?;
            let conclusions_json: String = row.get(1)?;
            let action_items_json: String = row.get(2)?;
            let discussion_json: String = row.get(3)?;
            let decisions_json: Option<String> = row.get(4)?;
            let technical_details_json: Option<String> = row.get(5)?;
            let next_steps_json: Option<String> = row.get(6)?;
            let raw_markdown: String = row.get(7)?;
            let edited_markdown: Option<String> = row.get(8)?;

            Ok((
                topic,
                conclusions_json,
                action_items_json,
                discussion_json,
                decisions_json,
                technical_details_json,
                next_steps_json,
                raw_markdown,
                edited_markdown,
            ))
        })
        .optional()
        .map_err(|e: rusqlite::Error| e.to_string())?;

    match result {
        Some((topic, conclusions_json, action_items_json, discussion_json, decisions_json, technical_details_json, next_steps_json, raw_markdown, edited_markdown)) => {
            let conclusions: Vec<String> =
                serde_json::from_str(&conclusions_json).unwrap_or_default();
            let action_items: Vec<ActionItem> =
                serde_json::from_str(&action_items_json).unwrap_or_default();
            let discussion: Vec<DiscussionItem> =
                serde_json::from_str(&discussion_json).unwrap_or_default();
            let decisions: Vec<Decision> = decisions_json
                .as_deref()
                .map(|s| serde_json::from_str(s).unwrap_or_default())
                .unwrap_or_default();
            let technical_details: Vec<TechnicalDetail> = technical_details_json
                .as_deref()
                .map(|s| serde_json::from_str(s).unwrap_or_default())
                .unwrap_or_default();
            let next_steps: Vec<String> = next_steps_json
                .as_deref()
                .map(|s| serde_json::from_str(s).unwrap_or_default())
                .unwrap_or_default();

            Ok(Some(Summary {
                topic,
                conclusions,
                decisions: Some(decisions),
                action_items,
                discussion,
                technical_details: Some(technical_details),
                next_steps: Some(next_steps),
                key_data: None,
                participants: None,
                raw_markdown,
                edited_markdown,
            }))
        }
        None => Ok(None),
    }
}

#[tauri::command]
pub fn db_save_summary(
    state: State<DatabaseState>,
    project_id: String,
    summary: Summary,
) -> Result<(), String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;

    let conclusions_json = serde_json::to_string(&summary.conclusions).map_err(|e| e.to_string())?;
    let action_items_json =
        serde_json::to_string(&summary.action_items).map_err(|e| e.to_string())?;
    let discussion_json =
        serde_json::to_string(&summary.discussion).map_err(|e| e.to_string())?;
    let decisions_json =
        serde_json::to_string(&summary.decisions.as_deref().unwrap_or(&[])).map_err(|e| e.to_string())?;
    let technical_details_json =
        serde_json::to_string(&summary.technical_details.as_deref().unwrap_or(&[])).map_err(|e| e.to_string())?;
    let next_steps_json =
        serde_json::to_string(&summary.next_steps.as_deref().unwrap_or(&[])).map_err(|e| e.to_string())?;

    let id = uuid::Uuid::new_v4().to_string();

    conn.execute(
        "INSERT OR REPLACE INTO summaries (id, project_id, topic, conclusions, action_items, discussion, decisions, technical_details, next_steps, raw_markdown, edited_markdown)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
        params![
            id,
            project_id,
            summary.topic,
            conclusions_json,
            action_items_json,
            discussion_json,
            decisions_json,
            technical_details_json,
            next_steps_json,
            summary.raw_markdown,
            summary.edited_markdown,
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Attachment CRUD commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn db_get_attachments(
    state: State<DatabaseState>,
    project_id: String,
) -> Result<Vec<Attachment>, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT id, project_id, filename, file_path, file_size, mime_type, created_at FROM attachments WHERE project_id = ?1 ORDER BY created_at DESC",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map(params![project_id], |row| {
            Ok(Attachment {
                id: row.get(0)?,
                project_id: row.get(1)?,
                filename: row.get(2)?,
                file_path: row.get(3)?,
                file_size: row.get(4)?,
                mime_type: row.get(5)?,
                created_at: row.get(6)?,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut attachments = Vec::new();
    for row in rows {
        attachments.push(row.map_err(|e| e.to_string())?);
    }
    Ok(attachments)
}

#[tauri::command]
pub fn db_add_attachment(
    app: AppHandle,
    state: State<DatabaseState>,
    project_id: String,
    source_path: String,
) -> Result<Attachment, String> {
    let source = Path::new(&source_path);
    if !source.exists() {
        return Err("Source file does not exist".to_string());
    }

    let filename = source
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("unknown")
        .to_string();

    let file_size = std::fs::metadata(&source)
        .map_err(|e| e.to_string())?
        .len() as i64;

    let mime_type = guess_mime_type(&filename).to_string();

    // Copy to attachments directory
    let app_data = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let dest_dir = app_data.join("attachments").join(&project_id);
    std::fs::create_dir_all(&dest_dir).map_err(|e| e.to_string())?;

    let dest_path = dest_dir.join(&filename);
    std::fs::copy(&source, &dest_path).map_err(|e| e.to_string())?;

    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    let file_path_str = dest_path.to_string_lossy().to_string();

    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO attachments (id, project_id, filename, file_path, file_size, mime_type, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![id, project_id, filename, file_path_str, file_size, mime_type, now],
    )
    .map_err(|e| e.to_string())?;

    Ok(Attachment {
        id,
        project_id,
        filename,
        file_path: file_path_str,
        file_size,
        mime_type,
        created_at: now,
    })
}

#[tauri::command]
pub fn db_delete_attachment(state: State<DatabaseState>, id: String) -> Result<(), String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;

    // Get file path first
    let file_path: Option<String> = conn
        .query_row(
            "SELECT file_path FROM attachments WHERE id = ?1",
            params![id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e: rusqlite::Error| e.to_string())?;

    // Delete disk file
    if let Some(path) = file_path {
        let _ = std::fs::remove_file(&path);
    }

    conn.execute("DELETE FROM attachments WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn db_open_attachment(state: State<DatabaseState>, id: String) -> Result<(), String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let file_path: String = conn
        .query_row(
            "SELECT file_path FROM attachments WHERE id = ?1",
            params![id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;

    open::that(&file_path).map_err(|e| e.to_string())?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Note CRUD commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn db_get_note(
    state: State<DatabaseState>,
    project_id: String,
) -> Result<Option<Note>, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let result: Option<Note> = conn
        .query_row(
            "SELECT id, project_id, content, updated_at FROM notes WHERE project_id = ?1",
            params![project_id],
            |row| {
                Ok(Note {
                    id: row.get(0)?,
                    project_id: row.get(1)?,
                    content: row.get(2)?,
                    updated_at: row.get(3)?,
                })
            },
        )
        .optional()
        .map_err(|e: rusqlite::Error| e.to_string())?;

    Ok(result)
}

#[tauri::command]
pub fn db_save_note(
    state: State<DatabaseState>,
    project_id: String,
    content: String,
) -> Result<(), String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();

    conn.execute(
        "INSERT INTO notes (id, project_id, content, updated_at) VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(project_id) DO UPDATE SET content = excluded.content, updated_at = excluded.updated_at",
        params![id, project_id, content, now],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Settings KV commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn db_get_setting(state: State<DatabaseState>, key: String) -> Result<Option<String>, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let result: Option<String> = conn
        .query_row(
            "SELECT value FROM settings WHERE key = ?1",
            params![key],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e: rusqlite::Error| e.to_string())?;
    Ok(result)
}

#[tauri::command]
pub fn db_set_setting(
    state: State<DatabaseState>,
    key: String,
    value: String,
) -> Result<(), String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT OR REPLACE INTO settings (key, value) VALUES (?1, ?2)",
        params![key, value],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn get_app_data_dir(app: AppHandle) -> Result<String, String> {
    let path = app.path().app_data_dir().map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().to_string())
}

// ---------------------------------------------------------------------------
// Full-text search across all persisted meeting transcripts
// ---------------------------------------------------------------------------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SegmentSearchResult {
    pub project_id: String,
    pub project_title: String,
    pub start_time: f64,
    pub text: String,
    pub speaker: Option<String>,
}

#[tauri::command]
pub fn db_search_segments(
    state: State<DatabaseState>,
    query: String,
    limit: Option<i64>,
) -> Result<Vec<SegmentSearchResult>, String> {
    let q = query.trim();
    if q.is_empty() {
        return Ok(Vec::new());
    }
    let pattern = format!(
        "%{}%",
        q.replace('\\', "\\\\").replace('%', "\\%").replace('_', "\\_")
    );
    let limit = limit.unwrap_or(50).clamp(1, 200);

    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT s.project_id, p.title, s.start_time, s.text, s.speaker
             FROM segments s
             JOIN projects p ON p.id = s.project_id
             WHERE s.text LIKE ?1 ESCAPE '\\'
             ORDER BY p.updated_at DESC, s.idx ASC
             LIMIT ?2",
        )
        .map_err(|e| e.to_string())?;

    let results = stmt
        .query_map(params![pattern, limit], |row| {
            Ok(SegmentSearchResult {
                project_id: row.get(0)?,
                project_title: row.get(1)?,
                start_time: row.get(2)?,
                text: row.get(3)?,
                speaker: row.get(4)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(results)
}

// ---------------------------------------------------------------------------
// Voiceprint data structures
// ---------------------------------------------------------------------------

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct VoiceprintInfo {
    pub id: String,
    pub name: String,
    pub nickname: String,
    pub email: String,
    pub department: String,
    pub title: String,
    pub note: String,
    pub avatar_path: Option<String>,
    pub sample_count: i32,
    pub model_version: String,
    pub created_at: String,
    pub updated_at: String,
    pub last_seen_at: Option<String>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VoiceprintMetadata {
    pub name: Option<String>,
    pub nickname: Option<String>,
    pub email: Option<String>,
    pub department: Option<String>,
    pub title: Option<String>,
    pub note: Option<String>,
    pub avatar_path: Option<String>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VoiceprintMatchResult {
    pub assignments: Vec<Option<String>>,
    pub speaker_names: Vec<Option<String>>,
    pub new_voiceprint_ids: Vec<String>,
}

// ---------------------------------------------------------------------------
// Voiceprint CRUD commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn voiceprint_list(state: State<DatabaseState>) -> Result<Vec<VoiceprintInfo>, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT id, name, nickname, email, department, title, note, avatar_path,
                    sample_count, model_version, created_at, updated_at, last_seen_at
             FROM voiceprints ORDER BY last_seen_at DESC NULLS LAST, updated_at DESC",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([], |row| {
            Ok(VoiceprintInfo {
                id: row.get(0)?,
                name: row.get(1)?,
                nickname: row.get(2)?,
                email: row.get(3)?,
                department: row.get(4)?,
                title: row.get(5)?,
                note: row.get(6)?,
                avatar_path: row.get(7)?,
                sample_count: row.get(8)?,
                model_version: row.get(9)?,
                created_at: row.get(10)?,
                updated_at: row.get(11)?,
                last_seen_at: row.get(12)?,
            })
        })
        .map_err(|e| e.to_string())?;

    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn voiceprint_update(
    state: State<DatabaseState>,
    id: String,
    metadata: VoiceprintMetadata,
) -> Result<(), String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let now = chrono::Utc::now().to_rfc3339();

    conn.execute(
        "UPDATE voiceprints SET
            name = COALESCE(?2, name),
            nickname = COALESCE(?3, nickname),
            email = COALESCE(?4, email),
            department = COALESCE(?5, department),
            title = COALESCE(?6, title),
            note = COALESCE(?7, note),
            avatar_path = COALESCE(?8, avatar_path),
            updated_at = ?1
         WHERE id = ?9",
        params![
            now,
            metadata.name,
            metadata.nickname,
            metadata.email,
            metadata.department,
            metadata.title,
            metadata.note,
            metadata.avatar_path,
            id,
        ],
    )
    .map_err(|e| e.to_string())?;

    // Sync speaker name to ALL segments across ALL projects that reference this voiceprint
    if let Some(ref new_name) = metadata.name {
        conn.execute(
            "UPDATE segments SET speaker = ?1 WHERE voiceprint_id = ?2",
            params![new_name, id],
        )
        .map_err(|e| e.to_string())?;
    }

    Ok(())
}

#[tauri::command]
pub fn voiceprint_create(
    state: State<DatabaseState>,
    name: String,
) -> Result<VoiceprintInfo, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let now = chrono::Utc::now().to_rfc3339();

    // Dedup: if a voiceprint with the same name already exists, return it
    let existing: Option<VoiceprintInfo> = conn
        .query_row(
            "SELECT id, name, nickname, email, department, title, note, avatar_path,
                    sample_count, model_version, created_at, updated_at, last_seen_at
             FROM voiceprints WHERE name = ?1 LIMIT 1",
            params![name],
            |row| {
                Ok(VoiceprintInfo {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    nickname: row.get(2)?,
                    email: row.get(3)?,
                    department: row.get(4)?,
                    title: row.get(5)?,
                    note: row.get(6)?,
                    avatar_path: row.get(7)?,
                    sample_count: row.get(8)?,
                    model_version: row.get(9)?,
                    created_at: row.get(10)?,
                    updated_at: row.get(11)?,
                    last_seen_at: row.get(12)?,
                })
            },
        )
        .optional()
        .map_err(|e| e.to_string())?;

    if let Some(vp) = existing {
        return Ok(vp);
    }

    let id = uuid::Uuid::new_v4().to_string();

    // Empty blob signals "no real embedding yet" — will be populated via passive learning
    let placeholder_embedding = vec![0u8; 0];

    conn.execute(
        "INSERT INTO voiceprints (id, name, embedding, sample_count, model_version, created_at, updated_at, last_seen_at)
         VALUES (?1, ?2, ?3, 0, '', ?4, ?4, ?4)",
        params![id, name, placeholder_embedding, now],
    )
    .map_err(|e| e.to_string())?;

    Ok(VoiceprintInfo {
        id,
        name,
        nickname: String::new(),
        email: String::new(),
        department: String::new(),
        title: String::new(),
        note: String::new(),
        avatar_path: None,
        sample_count: 0,
        model_version: String::new(),
        created_at: now.clone(),
        updated_at: now.clone(),
        last_seen_at: Some(now),
    })
}

#[tauri::command]
pub fn voiceprint_delete(state: State<DatabaseState>, id: String) -> Result<(), String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    tx.execute(
        "UPDATE segments SET voiceprint_id = NULL WHERE voiceprint_id = ?1",
        params![id],
    )
    .map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM voiceprints WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn voiceprint_merge(
    state: State<DatabaseState>,
    source_id: String,
    target_id: String,
) -> Result<(), String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;

    let (src_emb, src_count): (Vec<u8>, i32) = tx
        .query_row(
            "SELECT embedding, sample_count FROM voiceprints WHERE id = ?1",
            params![source_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(|e| e.to_string())?;
    let (tgt_emb, tgt_count): (Vec<u8>, i32) = tx
        .query_row(
            "SELECT embedding, sample_count FROM voiceprints WHERE id = ?1",
            params![target_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(|e| e.to_string())?;

    let merged = weighted_average_embeddings(&src_emb, src_count, &tgt_emb, tgt_count);
    let new_count = src_count + tgt_count;
    let now = chrono::Utc::now().to_rfc3339();

    tx.execute(
        "UPDATE voiceprints SET embedding = ?1, sample_count = ?2, updated_at = ?3 WHERE id = ?4",
        params![merged, new_count, now, target_id],
    )
    .map_err(|e| e.to_string())?;

    tx.execute(
        "UPDATE segments SET voiceprint_id = ?1 WHERE voiceprint_id = ?2",
        params![target_id, source_id],
    )
    .map_err(|e| e.to_string())?;

    tx.execute("DELETE FROM voiceprints WHERE id = ?1", params![source_id])
        .map_err(|e| e.to_string())?;

    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Voiceprint matching command (core algorithm)
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn voiceprint_match(
    state: State<DatabaseState>,
    embeddings: Vec<Option<Vec<f32>>>,
    threshold: f64,
) -> Result<VoiceprintMatchResult, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let now = chrono::Utc::now().to_rfc3339();

    // 1. Load all voiceprint embeddings from DB
    let mut stmt = conn
        .prepare("SELECT id, name, embedding, sample_count FROM voiceprints")
        .map_err(|e| e.to_string())?;
    let library: Vec<(String, String, Vec<u8>, i32)> = stmt
        .query_map([], |row| {
            Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?))
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    // Determine input embedding dimension from first non-None embedding
    let input_dim = embeddings.iter().find_map(|e| e.as_ref().map(|v| v.len())).unwrap_or(0);

    // Split library into matchable (correct dim, has real embedding) vs reusable (no real embedding)
    let mut matchable: Vec<&(String, String, Vec<u8>, i32)> = Vec::new();
    let mut reusable: Vec<&(String, String, Vec<u8>, i32)> = Vec::new();

    for entry in &library {
        let blob_dim = entry.2.len() / 4;
        if entry.3 == 0 || entry.2.is_empty() {
            // sample_count == 0 or empty blob: no real embedding, can be reused
            reusable.push(entry);
        } else if blob_dim == input_dim && input_dim > 0 {
            // Correct dimension with real embedding: can match
            matchable.push(entry);
        } else {
            // Wrong dimension with real embedding: model migration needed, skip matching
            // but still reusable (will overwrite old embedding with new model's)
            reusable.push(entry);
        }
    }

    let threshold_f32 = threshold as f32;
    let mut assignments: Vec<Option<String>> = vec![None; embeddings.len()];
    let mut speaker_names: Vec<Option<String>> = vec![None; embeddings.len()];
    let mut new_ids: Vec<String> = Vec::new();

    // 2. For each embedding, find best match in matchable library entries
    let mut unmatched: Vec<(usize, Vec<f32>)> = Vec::new();

    for (i, emb_opt) in embeddings.iter().enumerate() {
        let emb = match emb_opt {
            Some(e) => e,
            None => continue,
        };

        let mut best_sim: f32 = -1.0;
        let mut best_id: Option<String> = None;
        let mut best_name: Option<String> = None;

        for entry in &matchable {
            let sim = cosine_similarity_blob(emb, &entry.2);
            if sim > best_sim {
                best_sim = sim;
                best_id = Some(entry.0.clone());
                best_name = Some(entry.1.clone());
            }
        }

        if best_sim >= threshold_f32 {
            assignments[i] = best_id;
            speaker_names[i] = best_name;
        } else {
            unmatched.push((i, emb.clone()));
        }
    }

    // 3. Cluster unmatched embeddings
    let clusters = greedy_cluster(&unmatched, threshold_f32);

    // 4. For each cluster: reuse existing voiceprints first, then create new ones
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;

    let mut reusable_idx = 0;

    for member_indices in &clusters {
        let avg_emb = average_embeddings(
            &member_indices
                .iter()
                .map(|&mi| &unmatched[mi].1)
                .collect::<Vec<_>>(),
        );
        let blob = f32_vec_to_blob(&avg_emb);

        if reusable_idx < reusable.len() {
            // Reuse existing voiceprint: update its embedding (dimension migration / first learn)
            let reused = reusable[reusable_idx];
            reusable_idx += 1;

            tx.execute(
                "UPDATE voiceprints SET embedding = ?1, sample_count = ?2, updated_at = ?3, last_seen_at = ?3 WHERE id = ?4",
                params![blob, member_indices.len() as i32, now, reused.0],
            )
            .map_err(|e| e.to_string())?;

            for &mi in member_indices {
                let seg_idx = unmatched[mi].0;
                assignments[seg_idx] = Some(reused.0.clone());
                speaker_names[seg_idx] = Some(reused.1.clone());
            }
        } else {
            // No reusable voiceprints left, create new one
            let vp_id = uuid::Uuid::new_v4().to_string();
            let existing_unknown: i32 = tx
                .query_row(
                    "SELECT COUNT(*) FROM voiceprints WHERE name LIKE '未知说话人%'",
                    [],
                    |row| row.get(0),
                )
                .unwrap_or(0);
            let name = format!("未知说话人 {}", existing_unknown + 1);

            tx.execute(
                "INSERT INTO voiceprints (id, name, embedding, sample_count, model_version, created_at, updated_at, last_seen_at)
                 VALUES (?1, ?2, ?3, ?4, '', ?5, ?5, ?5)",
                params![vp_id, name, blob, member_indices.len() as i32, now],
            )
            .map_err(|e| e.to_string())?;

            new_ids.push(vp_id.clone());

            for &mi in member_indices {
                let seg_idx = unmatched[mi].0;
                assignments[seg_idx] = Some(vp_id.clone());
                speaker_names[seg_idx] = Some(name.clone());
            }
        }
    }

    // 5. Passive learn: update matched voiceprints' embeddings (reinforcement + dimension migration)
    let matched_ids: std::collections::HashSet<String> = assignments
        .iter()
        .filter_map(|a| a.as_ref())
        .filter(|id| !new_ids.contains(id))
        .cloned()
        .collect();

    for vp_id in &matched_ids {
        // Collect all embeddings assigned to this voiceprint
        let matched_embs: Vec<&Vec<f32>> = embeddings
            .iter()
            .enumerate()
            .filter_map(|(i, e)| {
                if assignments[i].as_ref() == Some(vp_id) {
                    e.as_ref()
                } else {
                    None
                }
            })
            .collect();

        if matched_embs.is_empty() {
            continue;
        }

        let new_avg = average_embeddings(&matched_embs);

        // Load current embedding for blending
        let row: Option<(Vec<u8>, i32)> = tx
            .query_row(
                "SELECT embedding, sample_count FROM voiceprints WHERE id = ?1",
                params![vp_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .ok();

        if let Some((old_blob, count)) = row {
            let max_count = 100;
            let updated_blob = if old_blob.is_empty() || old_blob.len() / 4 != new_avg.len() {
                // Empty or dimension mismatch: replace entirely with new embedding
                f32_vec_to_blob(&new_avg)
            } else {
                // 惯性上限：历史样本再多，新样本权重也不低于 ~5%，
                // 让早期低质量向量能被后续正确样本逐渐修正
                let n = count.min(20) as f32;
                blend_embeddings(&old_blob, &new_avg, n / (n + 1.0), 1.0 / (n + 1.0))
            };
            let new_count = (count + 1).min(max_count);
            tx.execute(
                "UPDATE voiceprints SET embedding = ?1, sample_count = ?2, updated_at = ?3, last_seen_at = ?3 WHERE id = ?4",
                params![updated_blob, new_count, now, vp_id],
            )
            .ok();
        }
    }

    tx.commit().map_err(|e| e.to_string())?;

    Ok(VoiceprintMatchResult {
        assignments,
        speaker_names,
        new_voiceprint_ids: new_ids,
    })
}

// ---------------------------------------------------------------------------
// Voiceprint passive learning command
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn voiceprint_passive_learn(
    state: State<DatabaseState>,
    id: String,
    new_embedding: Vec<f32>,
) -> Result<(), String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let now = chrono::Utc::now().to_rfc3339();

    let (old_blob, count): (Vec<u8>, i32) = conn
        .query_row(
            "SELECT embedding, sample_count FROM voiceprints WHERE id = ?1",
            params![id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(|e| e.to_string())?;

    let max_count = 100;

    // 惯性上限：与 voiceprint_match 内的被动学习保持一致
    let updated_blob = {
        let n = count.min(20) as f32;
        blend_embeddings(&old_blob, &new_embedding, n / (n + 1.0), 1.0 / (n + 1.0))
    };

    let new_count = (count + 1).min(max_count);

    conn.execute(
        "UPDATE voiceprints SET embedding = ?1, sample_count = ?2, updated_at = ?3 WHERE id = ?4",
        params![updated_blob, new_count, now, id],
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}

// ---------------------------------------------------------------------------
// Voiceprint helper functions
// ---------------------------------------------------------------------------

fn cosine_similarity_blob(emb: &[f32], blob: &[u8]) -> f32 {
    let dim = blob.len() / 4;
    if emb.len() != dim {
        return -1.0;
    }
    let mut dot: f32 = 0.0;
    let mut norm_a: f32 = 0.0;
    let mut norm_b: f32 = 0.0;
    for i in 0..dim {
        let b = f32::from_le_bytes([blob[i * 4], blob[i * 4 + 1], blob[i * 4 + 2], blob[i * 4 + 3]]);
        dot += emb[i] * b;
        norm_a += emb[i] * emb[i];
        norm_b += b * b;
    }
    let denom = norm_a.sqrt() * norm_b.sqrt();
    if denom < 1e-12 {
        0.0
    } else {
        dot / denom
    }
}

fn cosine_similarity_vec(a: &[f32], b: &[f32]) -> f32 {
    let mut dot: f32 = 0.0;
    let mut na: f32 = 0.0;
    let mut nb: f32 = 0.0;
    for i in 0..a.len().min(b.len()) {
        dot += a[i] * b[i];
        na += a[i] * a[i];
        nb += b[i] * b[i];
    }
    let denom = na.sqrt() * nb.sqrt();
    if denom < 1e-12 {
        0.0
    } else {
        dot / denom
    }
}

fn greedy_cluster(items: &[(usize, Vec<f32>)], threshold: f32) -> Vec<Vec<usize>> {
    let mut clusters: Vec<Vec<usize>> = Vec::new();
    let mut centroids: Vec<Vec<f32>> = Vec::new();

    for (item_idx, (_, emb)) in items.iter().enumerate() {
        let mut best_cluster = None;
        let mut best_sim: f32 = -1.0;

        for (ci, centroid) in centroids.iter().enumerate() {
            let sim = cosine_similarity_vec(emb, centroid);
            if sim > best_sim {
                best_sim = sim;
                best_cluster = Some(ci);
            }
        }

        if best_sim >= threshold && best_cluster.is_some() {
            let ci = best_cluster.unwrap();
            clusters[ci].push(item_idx);
            let members: Vec<&Vec<f32>> = clusters[ci].iter().map(|&mi| &items[mi].1).collect();
            centroids[ci] = average_embeddings(&members);
        } else {
            clusters.push(vec![item_idx]);
            centroids.push(emb.clone());
        }
    }
    clusters
}

fn average_embeddings(vecs: &[&Vec<f32>]) -> Vec<f32> {
    if vecs.is_empty() {
        return Vec::new();
    }
    let dim = vecs[0].len();
    let mut avg = vec![0.0f32; dim];
    for v in vecs {
        for i in 0..dim {
            avg[i] += v[i];
        }
    }
    let n = vecs.len() as f32;
    let mut norm: f32 = 0.0;
    for v in &mut avg {
        *v /= n;
        norm += *v * *v;
    }
    let norm = norm.sqrt().max(1e-12);
    for v in &mut avg {
        *v /= norm;
    }
    avg
}

fn f32_vec_to_blob(v: &[f32]) -> Vec<u8> {
    v.iter().flat_map(|f| f.to_le_bytes()).collect()
}

fn weighted_average_embeddings(a: &[u8], count_a: i32, b: &[u8], count_b: i32) -> Vec<u8> {
    if a.len() != b.len() || a.len() % 4 != 0 {
        return a.to_vec();
    }
    let dim = a.len() / 4;
    let total = (count_a + count_b) as f32;
    let wa = count_a as f32 / total;
    let wb = count_b as f32 / total;

    let mut floats = Vec::with_capacity(dim);
    let mut norm_sq: f32 = 0.0;
    for i in 0..dim {
        let va = f32::from_le_bytes([a[i * 4], a[i * 4 + 1], a[i * 4 + 2], a[i * 4 + 3]]);
        let vb = f32::from_le_bytes([b[i * 4], b[i * 4 + 1], b[i * 4 + 2], b[i * 4 + 3]]);
        let v = va * wa + vb * wb;
        floats.push(v);
        norm_sq += v * v;
    }

    let norm = norm_sq.sqrt().max(1e-12);
    let mut result = Vec::with_capacity(a.len());
    for v in floats {
        result.extend_from_slice(&(v / norm).to_le_bytes());
    }
    result
}

fn blend_embeddings(old_blob: &[u8], new_emb: &[f32], w_old: f32, w_new: f32) -> Vec<u8> {
    let dim = new_emb.len();
    if old_blob.len() != dim * 4 {
        return f32_vec_to_blob(new_emb);
    }
    let mut floats = Vec::with_capacity(dim);
    let mut norm_sq: f32 = 0.0;

    for i in 0..dim {
        let old_v = f32::from_le_bytes([
            old_blob[i * 4],
            old_blob[i * 4 + 1],
            old_blob[i * 4 + 2],
            old_blob[i * 4 + 3],
        ]);
        let v = old_v * w_old + new_emb[i] * w_new;
        floats.push(v);
        norm_sq += v * v;
    }

    let norm = norm_sq.sqrt().max(1e-12);
    let mut result = Vec::with_capacity(dim * 4);
    for v in floats {
        result.extend_from_slice(&(v / norm).to_le_bytes());
    }
    result
}
