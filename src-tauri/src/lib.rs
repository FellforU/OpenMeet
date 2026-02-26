mod audio_capture;
mod crypto;
mod database;
mod sidecar;

use audio_capture::AudioCaptureState;
use crypto::CryptoState;
use sidecar::SidecarState;
use tauri::Manager;

#[tauri::command]
fn open_url(url: String) -> Result<(), String> {
    open::that(&url).map_err(|e| e.to_string())
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
            open_url,
            crypto::encrypt_secret,
            crypto::decrypt_secret,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
