mod audio_capture;
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
