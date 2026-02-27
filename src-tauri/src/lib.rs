mod audio_capture;
mod crypto;
mod database;
mod sidecar;

use audio_capture::AudioCaptureState;
use crypto::CryptoState;
use sidecar::SidecarState;
use std::collections::HashMap;
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
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
            database::get_app_data_dir,
            http_fetch,
            open_url,
            reveal_file,
            crypto::encrypt_secret,
            crypto::decrypt_secret,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
