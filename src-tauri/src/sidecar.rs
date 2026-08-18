use std::path::{Path, PathBuf};
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

/// Find the project root directory (where asr_service/ lives).
/// In dev mode, current_dir is src-tauri/, so we check the parent.
fn find_project_root() -> Result<PathBuf, String> {
    let cwd = std::env::current_dir().map_err(|e| e.to_string())?;

    // Check if asr_service/ exists in current dir
    if cwd.join("asr_service").is_dir() {
        return Ok(cwd);
    }
    // Check parent (when running from src-tauri/)
    if let Some(parent) = cwd.parent() {
        if parent.join("asr_service").is_dir() {
            return Ok(parent.to_path_buf());
        }
    }
    // Fallback to current dir
    Ok(cwd)
}

/// Find the best Python executable: prefer venv Python, fall back to system Python.
fn find_python(project_root: &PathBuf) -> String {
    // Try virtualenv Python first
    let venv_candidates = if cfg!(target_os = "windows") {
        vec![
            project_root.join(".venv/Scripts/python.exe"),
            project_root.join("venv/Scripts/python.exe"),
        ]
    } else {
        vec![
            project_root.join(".venv/bin/python"),
            project_root.join("venv/bin/python"),
        ]
    };

    for candidate in venv_candidates {
        if candidate.exists() {
            return candidate.to_string_lossy().to_string();
        }
    }

    // Fallback to system Python
    if cfg!(target_os = "windows") {
        "python".to_string()
    } else {
        "python3".to_string()
    }
}

/// Run GPU auto-detection and install CUDA PyTorch if needed.
/// This runs before the ASR service starts so torch imports get the CUDA version.
fn run_gpu_setup(python: &str, project_root: &Path) {
    eprintln!("[sidecar] Running GPU setup...");
    match Command::new(python)
        .args(["-m", "asr_service.gpu_setup"])
        .current_dir(project_root)
        .stdout(std::process::Stdio::inherit())
        .stderr(std::process::Stdio::inherit())
        .status()
    {
        Ok(status) => {
            let code = status.code().unwrap_or(-1);
            match code {
                0 => eprintln!("[sidecar] GPU setup: no changes needed"),
                1 => eprintln!("[sidecar] GPU setup: CUDA PyTorch installed"),
                _ => eprintln!("[sidecar] GPU setup: completed with code {}", code),
            }
        }
        Err(e) => eprintln!("[sidecar] GPU setup failed (non-fatal): {}", e),
    }
}

#[tauri::command]
pub async fn start_asr_service(
    state: State<'_, SidecarState>,
    cache_dir: Option<String>,
) -> Result<String, String> {
    let mut proc_guard = state.process.lock().map_err(|e| e.to_string())?;

    if proc_guard.is_some() {
        return Ok("ASR service already running".to_string());
    }

    let project_root = find_project_root()?;
    let python = find_python(&project_root);

    // Auto-detect GPU and install CUDA PyTorch before starting the service
    run_gpu_setup(&python, &project_root);

    let mut cmd = Command::new(&python);
    cmd.args(["-m", "asr_service.main"])
        .current_dir(&project_root);

    // Inject cache env vars — models go into {cache_dir}/models subdirectory
    // （模型下载统一走 ModelScope 国内源）
    if let Some(ref dir) = cache_dir {
        let models_dir = Path::new(dir).join("models");
        let models_str = models_dir.to_string_lossy().to_string();
        cmd.env("MODELSCOPE_CACHE", &models_str);
        cmd.env("OPENMEET_CACHE_DIR", dir);
    }

    let child = cmd
        .spawn()
        .map_err(|e| format!("Failed to start ASR service (python={}): {}", python, e))?;

    *proc_guard = Some(child);
    Ok(format!("ASR service started (python={}, root={})", python, project_root.display()))
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
