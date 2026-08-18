mod audio_capture;
mod capture;
mod crypto;
mod database;
mod sidecar;

use audio_capture::AudioCaptureState;
use base64::Engine;
use crypto::CryptoState;
use sidecar::SidecarState;
use std::collections::HashMap;
use std::path::Path;
use tauri::Manager;

#[derive(serde::Serialize)]
struct HttpFetchResponse {
    status: u16,
    body: String,
}

/// Proxy HTTP requests from the frontend to bypass CORS restrictions.
#[tauri::command]
async fn http_fetch(
    url: String,
    method: String,
    headers: Option<HashMap<String, String>>,
    body: Option<String>,
) -> Result<HttpFetchResponse, String> {
    let client = reqwest::Client::new();
    let mut builder = match method.to_uppercase().as_str() {
        "GET" => client.get(&url),
        "POST" => client.post(&url),
        "PUT" => client.put(&url),
        "DELETE" => client.delete(&url),
        _ => return Err(format!("Unsupported HTTP method: {}", method)),
    };

    if let Some(hdrs) = headers {
        for (key, value) in hdrs {
            builder = builder.header(key, value);
        }
    }

    if let Some(b) = body {
        builder = builder.body(b);
    }

    let resp = builder.send().await.map_err(|e| e.to_string())?;
    let status = resp.status().as_u16();
    let resp_body = resp.text().await.map_err(|e| e.to_string())?;

    Ok(HttpFetchResponse {
        status,
        body: resp_body,
    })
}

#[tauri::command]
fn open_url(url: String) -> Result<(), String> {
    open::that(&url).map_err(|e| e.to_string())
}

/// Open the system file explorer and highlight the given file
#[tauri::command]
fn reveal_file(path: String) -> Result<(), String> {
    let p = std::path::Path::new(&path);
    if !p.exists() {
        return Err("File not found".to_string());
    }

    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .args(["/select,", &path])
            .spawn()
            .map_err(|e| e.to_string())?;
        return Ok(());
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .args(["-R", &path])
            .spawn()
            .map_err(|e| e.to_string())?;
        return Ok(());
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        if let Some(parent) = p.parent() {
            open::that(parent).map_err(|e| e.to_string())?;
        }
        Ok(())
    }
}

#[tauri::command]
async fn pick_folder() -> Result<Option<String>, String> {
    let handle = rfd::AsyncFileDialog::new().pick_folder().await;
    Ok(handle.map(|h| h.path().to_string_lossy().to_string()))
}

#[tauri::command]
async fn pick_audio_file() -> Result<Option<String>, String> {
    let handle = rfd::AsyncFileDialog::new()
        .add_filter(
            "Audio/Video",
            &["mp3", "wav", "m4a", "mp4", "mkv", "flac", "ogg", "webm", "aac"],
        )
        .pick_file()
        .await;
    Ok(handle.map(|h| h.path().to_string_lossy().to_string()))
}

#[tauri::command]
async fn save_file_dialog(
    default_name: String,
    filters: Vec<(String, Vec<String>)>,
) -> Result<Option<String>, String> {
    let mut dialog = rfd::AsyncFileDialog::new().set_file_name(&default_name);
    for (name, exts) in &filters {
        let ext_refs: Vec<&str> = exts.iter().map(|s| s.as_str()).collect();
        dialog = dialog.add_filter(name, &ext_refs);
    }
    let handle = dialog.save_file().await;
    Ok(handle.map(|h| h.path().to_string_lossy().to_string()))
}

#[tauri::command]
fn write_text_file(path: String, content: String) -> Result<(), String> {
    std::fs::write(&path, &content).map_err(|e| e.to_string())
}

#[tauri::command]
fn write_binary_file(path: String, data: String) -> Result<(), String> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(&data)
        .map_err(|e| format!("Base64 decode error: {}", e))?;
    std::fs::write(&path, &bytes).map_err(|e| e.to_string())
}

#[tauri::command]
async fn migrate_cache_dir(from: String, to: String) -> Result<String, String> {
    let src = Path::new(&from);
    let dst = Path::new(&to);

    if !src.exists() {
        return Err("Source directory does not exist".to_string());
    }

    std::fs::create_dir_all(dst).map_err(|e| format!("Failed to create target directory: {}", e))?;

    let mut file_count: u64 = 0;
    let mut total_bytes: u64 = 0;

    fn copy_recursive(src: &Path, dst: &Path, count: &mut u64, bytes: &mut u64) -> Result<(), String> {
        for entry in std::fs::read_dir(src).map_err(|e| format!("Read dir failed: {}", e))? {
            let entry = entry.map_err(|e| format!("Entry error: {}", e))?;
            let src_path = entry.path();
            let dst_path = dst.join(entry.file_name());

            if src_path.is_dir() {
                std::fs::create_dir_all(&dst_path)
                    .map_err(|e| format!("Create dir failed: {}", e))?;
                copy_recursive(&src_path, &dst_path, count, bytes)?;
            } else if !dst_path.exists() {
                let metadata = std::fs::metadata(&src_path)
                    .map_err(|e| format!("Metadata error: {}", e))?;
                std::fs::copy(&src_path, &dst_path)
                    .map_err(|e| format!("Copy failed: {}", e))?;
                *count += 1;
                *bytes += metadata.len();
            }
        }
        Ok(())
    }

    copy_recursive(src, dst, &mut file_count, &mut total_bytes)?;

    let size_mb = total_bytes as f64 / 1_048_576.0;
    Ok(format!("{} files copied ({:.1} MB)", file_count, size_mb))
}

#[tauri::command]
fn get_default_cache_dir() -> String {
    dirs::home_dir()
        .unwrap_or_default()
        .join(".cache")
        .join("openmeet")
        .to_string_lossy()
        .to_string()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            let icon =
                tauri::image::Image::from_bytes(include_bytes!("../icons/128x128.png"))?;
            for (_, window) in app.webview_windows() {
                let _ = window.set_icon(icon.clone());
            }

            // Initialize SQLite database
            let db_path = app.path().app_data_dir()?.join("openmeet.db");
            std::fs::create_dir_all(db_path.parent().unwrap()).ok();
            let db = database::Database::new(&db_path)
                .map_err(|e| Box::<dyn std::error::Error>::from(e))?;
            app.manage(db);

            // Initialize crypto state with app data directory
            let crypto_state = app.state::<CryptoState>();
            let app_data = app.path().app_data_dir()?;
            crypto_state.init(&app_data);

            Ok(())
        })
        .manage(SidecarState::new())
        .manage(AudioCaptureState::new())
        .manage(CryptoState::new())
        .invoke_handler(tauri::generate_handler![
            sidecar::start_asr_service,
            sidecar::stop_asr_service,
            sidecar::check_asr_health,
            audio_capture::list_audio_devices,
            audio_capture::start_recording,
            audio_capture::stop_recording,
            audio_capture::pause_recording,
            audio_capture::resume_recording,
            audio_capture::merge_wav_files,
            audio_capture::read_audio_file,
            // Database commands
            database::db_get_all_projects,
            database::db_add_project,
            database::db_update_project,
            database::db_delete_project,
            database::db_reorder_projects,
            database::db_get_segments,
            database::db_save_segments,
            database::db_get_summary,
            database::db_save_summary,
            database::db_get_attachments,
            database::db_add_attachment,
            database::db_delete_attachment,
            database::db_open_attachment,
            database::db_get_note,
            database::db_save_note,
            database::db_get_setting,
            database::db_set_setting,
            database::db_search_segments,
            database::get_app_data_dir,
            // Voiceprint commands
            database::voiceprint_list,
            database::voiceprint_create,
            database::voiceprint_update,
            database::voiceprint_delete,
            database::voiceprint_merge,
            database::voiceprint_match,
            database::voiceprint_passive_learn,
            http_fetch,
            open_url,
            reveal_file,
            pick_folder,
            pick_audio_file,
            save_file_dialog,
            write_text_file,
            write_binary_file,
            migrate_cache_dir,
            get_default_cache_dir,
            crypto::encrypt_secret,
            crypto::decrypt_secret,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
