mod audio_capture;
mod database;
mod sidecar;

use audio_capture::AudioCaptureState;
use sidecar::SidecarState;
use tauri::Manager;

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

            Ok(())
        })
        .manage(SidecarState::new())
        .manage(AudioCaptureState::new())
        .invoke_handler(tauri::generate_handler![
            sidecar::start_asr_service,
            sidecar::stop_asr_service,
            sidecar::check_asr_health,
            audio_capture::list_audio_devices,
            audio_capture::start_recording,
            audio_capture::stop_recording,
            audio_capture::pause_recording,
            audio_capture::resume_recording,
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
