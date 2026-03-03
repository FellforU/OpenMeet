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
            ",
        )
        .map_err(|e| e.to_string())?;

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

#[derive(Serialize, Deserialize, Clone)]
pub struct Summary {
    pub topic: String,
    pub conclusions: Vec<String>,
    pub action_items: Vec<ActionItem>,
    pub discussion: Vec<DiscussionItem>,
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
            "SELECT id, start_time, end_time, text, speaker, confidence FROM segments WHERE project_id = ?1 ORDER BY idx",
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
            "INSERT INTO segments (id, project_id, idx, start_time, end_time, text, speaker, confidence)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                seg.id,
                project_id,
                i as i32,
                seg.start,
                seg.end,
                seg.text,
                seg.speaker,
                seg.confidence,
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
            "SELECT topic, conclusions, action_items, discussion, raw_markdown, edited_markdown FROM summaries WHERE project_id = ?1",
        )
        .map_err(|e| e.to_string())?;

    let result: Option<(String, String, String, String, String, Option<String>)> = stmt
        .query_row(params![project_id], |row| {
            let topic: String = row.get(0)?;
            let conclusions_json: String = row.get(1)?;
            let action_items_json: String = row.get(2)?;
            let discussion_json: String = row.get(3)?;
            let raw_markdown: String = row.get(4)?;
            let edited_markdown: Option<String> = row.get(5)?;

            Ok((
                topic,
                conclusions_json,
                action_items_json,
                discussion_json,
                raw_markdown,
                edited_markdown,
            ))
        })
        .optional()
        .map_err(|e: rusqlite::Error| e.to_string())?;

    match result {
        Some((topic, conclusions_json, action_items_json, discussion_json, raw_markdown, edited_markdown)) => {
            let conclusions: Vec<String> =
                serde_json::from_str(&conclusions_json).unwrap_or_default();
            let action_items: Vec<ActionItem> =
                serde_json::from_str(&action_items_json).unwrap_or_default();
            let discussion: Vec<DiscussionItem> =
                serde_json::from_str(&discussion_json).unwrap_or_default();

            Ok(Some(Summary {
                topic,
                conclusions,
                action_items,
                discussion,
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

    let id = uuid::Uuid::new_v4().to_string();

    conn.execute(
        "INSERT OR REPLACE INTO summaries (id, project_id, topic, conclusions, action_items, discussion, raw_markdown, edited_markdown)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![
            id,
            project_id,
            summary.topic,
            conclusions_json,
            action_items_json,
            discussion_json,
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
