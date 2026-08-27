use std::fs::File;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, State};

const ASR_SERVICE_URL: &str = "http://127.0.0.1:18090";

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

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

/// Where the Python service and interpreter live.
///
/// 打包版布局（安装目录）：
///   OpenMeet.exe
///   python/python.exe        嵌入式 Python + site-packages
///   asr_service/             服务源码
///   ffmpeg/ffmpeg.exe
/// 开发版布局：仓库根目录 + .venv
struct RuntimeLayout {
    /// Working directory for `python -m asr_service.main`
    root: PathBuf,
    python: String,
    packaged: bool,
}

fn resolve_layout() -> Result<RuntimeLayout, String> {
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            let py = if cfg!(target_os = "windows") {
                dir.join("python").join("python.exe")
            } else {
                dir.join("python").join("bin").join("python3")
            };
            if py.is_file() && dir.join("asr_service").is_dir() {
                return Ok(RuntimeLayout {
                    root: dir.to_path_buf(),
                    python: py.to_string_lossy().to_string(),
                    packaged: true,
                });
            }
        }
    }
    let root = find_project_root()?;
    let python = find_python(&root);
    Ok(RuntimeLayout {
        root,
        python,
        packaged: false,
    })
}

/// Find the project root directory (where asr_service/ lives).
/// In dev mode, current_dir is src-tauri/, so we check the parent.
fn find_project_root() -> Result<PathBuf, String> {
    let cwd = std::env::current_dir().map_err(|e| e.to_string())?;

    if cwd.join("asr_service").is_dir() {
        return Ok(cwd);
    }
    if let Some(parent) = cwd.parent() {
        if parent.join("asr_service").is_dir() {
            return Ok(parent.to_path_buf());
        }
    }
    Ok(cwd)
}

/// Find the best Python executable: prefer venv Python, fall back to system Python.
fn find_python(project_root: &Path) -> String {
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
        if candidate.is_file() {
            return candidate.to_string_lossy().to_string();
        }
    }

    if cfg!(target_os = "windows") {
        "python".to_string()
    } else {
        "python3".to_string()
    }
}

/// Build a python command with the runtime's environment applied.
fn python_cmd(layout: &RuntimeLayout, cache_dir: Option<&str>) -> Command {
    let mut cmd = Command::new(&layout.python);
    cmd.current_dir(&layout.root);

    // 自带 ffmpeg 优先于系统 PATH
    let ffmpeg_dir = layout.root.join("ffmpeg");
    if ffmpeg_dir.is_dir() {
        let sep = if cfg!(target_os = "windows") { ";" } else { ":" };
        let old = std::env::var("PATH").unwrap_or_default();
        cmd.env("PATH", format!("{}{}{}", ffmpeg_dir.display(), sep, old));
    }
    // 打包版不应读到用户机器上其他 Python 的 site-packages
    if layout.packaged {
        cmd.env_remove("PYTHONPATH");
        cmd.env_remove("PYTHONHOME");
        cmd.env("PYTHONIOENCODING", "utf-8");
    }

    // Inject cache env vars — models go into {cache_dir}/models subdirectory
    // （模型下载统一走 ModelScope 国内源）
    if let Some(dir) = cache_dir {
        let models_dir = Path::new(dir).join("models");
        cmd.env("MODELSCOPE_CACHE", models_dir.to_string_lossy().to_string());
        cmd.env("OPENMEET_CACHE_DIR", dir);
    }

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd
}

/// Open (truncating) a log file under the app log dir; None in dev mode.
fn open_log(app: &AppHandle, name: &str) -> Option<File> {
    let dir = app.path().app_log_dir().ok()?;
    std::fs::create_dir_all(&dir).ok()?;
    File::create(dir.join(name)).ok()
}

/// Dev mode: run GPU setup synchronously before the service (legacy behaviour,
/// the developer's venv may need CUDA torch installed).
fn run_gpu_setup_blocking(layout: &RuntimeLayout) {
    eprintln!("[sidecar] Running GPU setup...");
    match python_cmd(layout, None)
        .args(["-m", "asr_service.gpu_setup"])
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit())
        .status()
    {
        Ok(status) => eprintln!("[sidecar] GPU setup exit code {}", status.code().unwrap_or(-1)),
        Err(e) => eprintln!("[sidecar] GPU setup failed (non-fatal): {}", e),
    }
}

/// Packaged mode: the installer ships CPU torch. If an NVIDIA GPU is present,
/// install CUDA torch in the background and tell the UI to prompt a restart.
///
/// 事件 `gpu-setup` payload: "installing" | "installed" | "failed"
fn spawn_gpu_setup_background(app: AppHandle, layout: RuntimeLayout) {
    std::thread::spawn(move || {
        let log = open_log(&app, "gpu_setup.log");
        let (out, err) = match log {
            Some(f) => (
                Stdio::from(f.try_clone().unwrap_or(f)),
                Stdio::null(),
            ),
            None => (Stdio::null(), Stdio::null()),
        };

        // --check: exit 3 means "GPU present, CUDA torch missing, would install"
        let check = python_cmd(&layout, None)
            .args(["-m", "asr_service.gpu_setup", "--check"])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .ok()
            .and_then(|s| s.code());
        if check != Some(3) {
            return;
        }

        let _ = app.emit("gpu-setup", "installing");
        let status = python_cmd(&layout, None)
            .args(["-m", "asr_service.gpu_setup"])
            .stdout(out)
            .stderr(err)
            .status()
            .ok()
            .and_then(|s| s.code());
        let _ = app.emit(
            "gpu-setup",
            if status == Some(1) { "installed" } else { "failed" },
        );
    });
}

#[tauri::command]
pub async fn start_asr_service(
    app: AppHandle,
    state: State<'_, SidecarState>,
    cache_dir: Option<String>,
) -> Result<String, String> {
    let mut proc_guard = state.process.lock().map_err(|e| e.to_string())?;

    if proc_guard.is_some() {
        return Ok("ASR service already running".to_string());
    }

    let layout = resolve_layout()?;

    if !layout.packaged {
        run_gpu_setup_blocking(&layout);
    }

    let mut cmd = python_cmd(&layout, cache_dir.as_deref());
    cmd.args(["-m", "asr_service.main"]);

    if layout.packaged {
        // 无控制台：日志落到 app log 目录，便于用户反馈问题
        if let Some(f) = open_log(&app, "asr_service.log") {
            let f2 = f.try_clone().map_err(|e| e.to_string())?;
            cmd.stdout(Stdio::from(f)).stderr(Stdio::from(f2));
        }
    }

    let child = cmd
        .spawn()
        .map_err(|e| format!("Failed to start ASR service (python={}): {}", layout.python, e))?;

    *proc_guard = Some(child);

    let msg = format!(
        "ASR service started (python={}, root={}, packaged={})",
        layout.python,
        layout.root.display(),
        layout.packaged
    );

    if layout.packaged {
        spawn_gpu_setup_background(app, layout);
    }

    Ok(msg)
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
