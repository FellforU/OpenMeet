use std::process::{Child, Command};
use std::sync::Mutex;
use tauri::State;

const ASR_SERVICE_URL: &str = "http://127.0.0.1:18090";

pub struct SidecarState {
    pub process: Mutex<Option<Child>>,
}

impl SidecarState {
    pub fn new() -> Self {
        Self {
            process: Mutex::new(None),
        }
    }
}

impl Drop for SidecarState {
    fn drop(&mut self) {
        if let Ok(mut guard) = self.process.lock() {
            if let Some(mut child) = guard.take() {
                let _ = child.kill();
                let _ = child.wait();
            }
        }
    }
}

#[tauri::command]
pub async fn start_asr_service(state: State<'_, SidecarState>) -> Result<String, String> {
    let mut proc_guard = state.process.lock().map_err(|e| e.to_string())?;

    if proc_guard.is_some() {
        return Ok("ASR service already running".to_string());
    }

    let child = Command::new("python3")
        .args(["-m", "asr_service.main"])
        .current_dir(std::env::current_dir().map_err(|e| e.to_string())?)
        .spawn()
        .map_err(|e| format!("Failed to start ASR service: {}", e))?;

    *proc_guard = Some(child);
    Ok("ASR service started".to_string())
}

#[tauri::command]
pub async fn stop_asr_service(state: State<'_, SidecarState>) -> Result<String, String> {
    let mut proc_guard = state.process.lock().map_err(|e| e.to_string())?;

    if let Some(mut child) = proc_guard.take() {
        let _ = child.kill();
        let _ = child.wait();
        Ok("ASR service stopped".to_string())
    } else {
        Ok("ASR service not running".to_string())
    }
}

#[tauri::command]
pub async fn check_asr_health() -> Result<String, String> {
    let client = reqwest::Client::new();
    let url = format!("{}/health", ASR_SERVICE_URL);
    let resp = client
        .get(&url)
        .timeout(std::time::Duration::from_secs(3))
        .send()
        .await
        .map_err(|e| format!("ASR service not reachable: {}", e))?;

    let body = resp
        .text()
        .await
        .map_err(|e| format!("Failed to read response: {}", e))?;

    Ok(body)
}
