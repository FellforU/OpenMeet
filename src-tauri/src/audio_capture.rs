use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::sync::Arc;
use tauri::{Manager, State};

use crate::capture::types::{AudioSourceType, CaptureHandle, PcmBuffer};
use crate::capture::wav;

const WS_URL: &str = "ws://127.0.0.1:18090/ws/stream";
const CHUNK_DURATION_MS: u64 = 300;

pub struct AudioCaptureState {
    is_recording: Arc<AtomicBool>,
    is_paused: Arc<AtomicBool>,
    capture_handles: Mutex<Vec<CaptureHandle>>,
    ws_buffer: PcmBuffer,
    all_samples: PcmBuffer,
    rec_sample_rate: Mutex<u32>,
    rec_channels: Mutex<u16>,
    ws_channels: Mutex<u16>,
}

impl AudioCaptureState {
    pub fn new() -> Self {
        Self {
            is_recording: Arc::new(AtomicBool::new(false)),
            is_paused: Arc::new(AtomicBool::new(false)),
            capture_handles: Mutex::new(Vec::new()),
            ws_buffer: PcmBuffer::new(),
            all_samples: PcmBuffer::new(),
            rec_sample_rate: Mutex::new(16000),
            rec_channels: Mutex::new(1),
            ws_channels: Mutex::new(1),
        }
    }
}

#[derive(serde::Serialize)]
pub struct AudioDeviceInfo {
    pub name: String,
    pub sample_rate: u32,
    pub channels: u16,
}

#[tauri::command]
pub async fn list_audio_devices() -> Result<Vec<AudioDeviceInfo>, String> {
    use cpal::traits::{DeviceTrait, HostTrait};
    let host = cpal::default_host();
    let devices = host
        .input_devices()
        .map_err(|e| format!("Failed to list audio devices: {}", e))?;

    let mut result = Vec::new();
    for device in devices {
        let name = device.description().map(|d| d.name().to_string()).unwrap_or_else(|_| "Unknown".to_string());
        if let Ok(config) = device.default_input_config() {
            result.push(AudioDeviceInfo {
                name,
                sample_rate: config.sample_rate(),
                channels: config.channels(),
            });
        }
    }
    Ok(result)
}

/// Start a capture stream based on the audio source type.
/// Returns (handles, sample_rate, channels).
fn start_capture(
    source: AudioSourceType,
    is_paused: Arc<AtomicBool>,
    ws_buffer: PcmBuffer,
    all_buffer: PcmBuffer,
) -> Result<(Vec<CaptureHandle>, u32, u16), String> {
    match source {
        AudioSourceType::Microphone => {
            let (handle, sr, ch) =
                crate::capture::mic::start_mic_capture(is_paused, ws_buffer, all_buffer)?;
            Ok((vec![handle], sr, ch))
        }
        AudioSourceType::System => {
            start_system_capture(is_paused, ws_buffer, all_buffer)
        }
        AudioSourceType::Mixed => {
            start_mixed_capture(is_paused, ws_buffer, all_buffer)
        }
    }
}

/// Platform-dispatched system audio capture (mono)
fn start_system_capture(
    is_paused: Arc<AtomicBool>,
    ws_buffer: PcmBuffer,
    all_buffer: PcmBuffer,
) -> Result<(Vec<CaptureHandle>, u32, u16), String> {
    #[cfg(target_os = "windows")]
    {
        let (handle, sr, ch) =
            crate::capture::system_windows::start_system_capture(is_paused, ws_buffer, all_buffer)?;
        return Ok((vec![handle], sr, ch));
    }

    #[cfg(target_os = "macos")]
    {
        let (handle, sr, ch) =
            crate::capture::system_macos::start_system_capture(is_paused, ws_buffer, all_buffer)?;
        return Ok((vec![handle], sr, ch));
    }

    #[cfg(target_os = "linux")]
    {
        let (handle, sr, ch) =
            crate::capture::system_linux::start_system_capture(is_paused, ws_buffer, all_buffer)?;
        return Ok((vec![handle], sr, ch));
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    {
        Err("System audio capture is not supported on this platform".to_string())
    }
}

/// Mixed mode: mic (ch0) + system (ch1) interleaved to stereo
fn start_mixed_capture(
    is_paused: Arc<AtomicBool>,
    ws_buffer: PcmBuffer,
    all_buffer: PcmBuffer,
) -> Result<(Vec<CaptureHandle>, u32, u16), String> {
    // Separate raw buffers for mic and system — one buffer each to avoid double-push.
    // The interleaver thread reads from these and writes stereo to ws_buffer + all_buffer.
    let mic_raw = PcmBuffer::new();
    let mic_discard = PcmBuffer::new(); // unused second param
    let sys_raw = PcmBuffer::new();
    let sys_discard = PcmBuffer::new(); // unused second param

    let (mic_handle, sr, _) =
        crate::capture::mic::start_mic_capture(is_paused.clone(), mic_raw.clone(), mic_discard)?;

    let sys_result = start_system_capture(is_paused.clone(), sys_raw.clone(), sys_discard);
    let sys_handles = match sys_result {
        Ok((handles, _, _)) => handles,
        Err(e) => {
            eprintln!("System audio unavailable in mixed mode: {}", e);
            // Degrade: mic-only, still mono
            return Ok((vec![mic_handle], sr, 1));
        }
    };

    // Spawn interleaver thread: reads from mic_raw + sys_raw
    // WS buffer gets mic-only mono (for better ASR accuracy)
    // All buffer gets interleaved stereo with attenuated system audio (for WAV recording)
    let is_paused_clone = is_paused;
    let is_rec = Arc::new(AtomicBool::new(true));
    let is_rec_clone = is_rec.clone();

    std::thread::spawn(move || {
        let interval = std::time::Duration::from_millis(50);
        while is_rec_clone.load(Ordering::SeqCst) {
            std::thread::sleep(interval);
            if is_paused_clone.load(Ordering::SeqCst) {
                continue;
            }

            let mic_samples = mic_raw.drain();
            let sys_samples = sys_raw.drain();

            if mic_samples.is_empty() && sys_samples.is_empty() {
                continue;
            }

            // WS buffer: mic only (mono) for better ASR accuracy
            if !mic_samples.is_empty() {
                ws_buffer.push_samples(&mic_samples);
            }

            // Recording buffer: interleaved stereo [mic, sys_attenuated, ...]
            let len = mic_samples.len().max(sys_samples.len());
            let mut stereo = Vec::with_capacity(len * 2);
            for i in 0..len {
                let m = mic_samples.get(i).copied().unwrap_or(0);
                let s = sys_samples.get(i).copied().unwrap_or(0);
                let s_attenuated = ((s as f32) * 0.3) as i16; // System audio attenuation
                stereo.push(m);
                stereo.push(s_attenuated);
            }
            all_buffer.push_samples(&stereo);
        }
    });

    let mut handles = vec![mic_handle];
    handles.extend(sys_handles);
    // Store is_rec flag so interleaver stops when recording stops
    handles.push(CaptureHandle::new(is_rec));
    Ok((handles, sr, 2)) // stereo
}

#[tauri::command]
pub async fn start_recording(
    state: State<'_, AudioCaptureState>,
    job_id: String,
    audio_source: Option<String>,
) -> Result<String, String> {
    if state.is_recording.load(Ordering::SeqCst) {
        return Err("Already recording".to_string());
    }

    let source = AudioSourceType::from_str_opt(audio_source.as_deref());

    // Clear buffers
    state.ws_buffer.clear();
    state.all_samples.clear();

    // Start capture
    let (handles, sample_rate, channels) = start_capture(
        source,
        state.is_paused.clone(),
        state.ws_buffer.clone(),
        state.all_samples.clone(),
    )?;

    // Store recording parameters
    if let Ok(mut sr) = state.rec_sample_rate.lock() {
        *sr = sample_rate;
    }
    if let Ok(mut ch) = state.rec_channels.lock() {
        *ch = channels;
    }

    // In mixed mode, WS sends mic-only mono while recording is stereo
    let ws_ch = if source == AudioSourceType::Mixed { 1 } else { channels };
    if let Ok(mut wc) = state.ws_channels.lock() {
        *wc = ws_ch;
    }

    state.is_recording.store(true, Ordering::SeqCst);
    state.is_paused.store(false, Ordering::SeqCst);

    // Store capture handles
    if let Ok(mut guard) = state.capture_handles.lock() {
        *guard = handles;
    }

    // Spawn WebSocket sender task
    let is_rec = state.is_recording.clone();
    let is_pau = state.is_paused.clone();
    let buf = state.ws_buffer.clone();

    tokio::spawn(async move {
        use futures_util::SinkExt;
        use tokio_tungstenite::connect_async;

        let ws_url = format!(
            "{}?job_id={}&sample_rate={}&channels={}",
            WS_URL, job_id, sample_rate, ws_ch
        );
        let connect_result = connect_async(&ws_url).await;
        let (mut ws_stream, _) = match connect_result {
            Ok(conn) => conn,
            Err(e) => {
                eprintln!("WebSocket connection failed: {}", e);
                return;
            }
        };

        let interval = std::time::Duration::from_millis(CHUNK_DURATION_MS);
        while is_rec.load(Ordering::SeqCst) {
            tokio::time::sleep(interval).await;

            if is_pau.load(Ordering::SeqCst) {
                continue;
            }

            let samples = buf.drain();
            if samples.is_empty() {
                continue;
            }

            let chunk: Vec<u8> = samples.iter().flat_map(|s| s.to_le_bytes()).collect();
            let msg = tokio_tungstenite::tungstenite::Message::Binary(chunk.into());
            if ws_stream.send(msg).await.is_err() {
                eprintln!("WebSocket send failed, stopping");
                break;
            }
        }

        let close = tokio_tungstenite::tungstenite::Message::Close(None);
        let _ = ws_stream.send(close).await;
    });

    Ok(format!(
        "Recording started: {}Hz, {} channels, source={:?}",
        sample_rate, channels, source
    ))
}

#[tauri::command]
pub async fn stop_recording(
    app: tauri::AppHandle,
    state: State<'_, AudioCaptureState>,
) -> Result<String, String> {
    state.is_recording.store(false, Ordering::SeqCst);
    state.is_paused.store(false, Ordering::SeqCst);

    // Drop all capture handles to stop streams
    if let Ok(mut guard) = state.capture_handles.lock() {
        guard.clear();
    }

    let sample_rate = state.rec_sample_rate.lock().map(|sr| *sr).unwrap_or(16000);
    let channels = state.rec_channels.lock().map(|ch| *ch).unwrap_or(1);

    let samples = state.all_samples.drain();
    if samples.is_empty() {
        return Ok(String::new());
    }

    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;
    let recordings_dir = data_dir.join("recordings");
    std::fs::create_dir_all(&recordings_dir)
        .map_err(|e| format!("Failed to create recordings dir: {}", e))?;

    let timestamp = chrono::Local::now().format("%Y%m%d_%H%M%S");
    let filename = format!("{}.wav", timestamp);
    let wav_path = recordings_dir.join(&filename);

    wav::write_wav(&wav_path, &samples, sample_rate, channels)?;

    Ok(wav_path.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn pause_recording(state: State<'_, AudioCaptureState>) -> Result<String, String> {
    if !state.is_recording.load(Ordering::SeqCst) {
        return Err("Not recording".to_string());
    }
    state.is_paused.store(true, Ordering::SeqCst);
    Ok("Recording paused".to_string())
}

#[tauri::command]
pub async fn resume_recording(state: State<'_, AudioCaptureState>) -> Result<String, String> {
    if !state.is_recording.load(Ordering::SeqCst) {
        return Err("Not recording".to_string());
    }
    state.is_paused.store(false, Ordering::SeqCst);
    Ok("Recording resumed".to_string())
}

#[tauri::command]
pub async fn read_audio_file(path: String) -> Result<String, String> {
    use base64::Engine as _;
    let data = std::fs::read(&path)
        .map_err(|e| format!("Failed to read audio file: {}", e))?;
    Ok(base64::engine::general_purpose::STANDARD.encode(&data))
}

#[tauri::command]
pub async fn merge_wav_files(paths: Vec<String>) -> Result<String, String> {
    if paths.is_empty() {
        return Err("No files to merge".to_string());
    }
    if paths.len() == 1 {
        return Ok(paths[0].clone());
    }

    let first_path = PathBuf::from(&paths[0]);
    let (mut all_samples, sample_rate, channels) = wav::read_wav_samples(&first_path)?;

    for p in &paths[1..] {
        let path = PathBuf::from(p);
        let (samples, _, _) = wav::read_wav_samples(&path)?;
        all_samples.extend_from_slice(&samples);
    }

    wav::write_wav(&first_path, &all_samples, sample_rate, channels)?;

    for p in &paths[1..] {
        std::fs::remove_file(p).ok();
    }

    Ok(first_path.to_string_lossy().to_string())
}
