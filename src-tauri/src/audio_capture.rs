use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::State;

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};

const WS_URL: &str = "ws://127.0.0.1:18090/ws/stream";
const CHUNK_DURATION_MS: u64 = 300;

/// Wrapper to make cpal::Stream usable in Tauri state.
/// Safety: Stream is only accessed from the main thread via Mutex guards.
struct StreamWrapper(#[allow(dead_code)] cpal::Stream);
unsafe impl Send for StreamWrapper {}
unsafe impl Sync for StreamWrapper {}

pub struct AudioCaptureState {
    is_recording: Arc<AtomicBool>,
    is_paused: Arc<AtomicBool>,
    stream_handle: Mutex<Option<StreamWrapper>>,
}

impl AudioCaptureState {
    pub fn new() -> Self {
        Self {
            is_recording: Arc::new(AtomicBool::new(false)),
            is_paused: Arc::new(AtomicBool::new(false)),
            stream_handle: Mutex::new(None),
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
    let host = cpal::default_host();
    let devices = host
        .input_devices()
        .map_err(|e| format!("Failed to list audio devices: {}", e))?;

    let mut result = Vec::new();
    for device in devices {
        let name = device.name().unwrap_or_else(|_| "Unknown".to_string());
        if let Ok(config) = device.default_input_config() {
            result.push(AudioDeviceInfo {
                name,
                sample_rate: config.sample_rate().0,
                channels: config.channels(),
            });
        }
    }
    Ok(result)
}

#[tauri::command]
pub async fn start_recording(
    state: State<'_, AudioCaptureState>,
    job_id: String,
) -> Result<String, String> {
    if state.is_recording.load(Ordering::SeqCst) {
        return Err("Already recording".to_string());
    }

    let host = cpal::default_host();
    let device = host
        .default_input_device()
        .ok_or_else(|| "No input device available".to_string())?;

    let config = device
        .default_input_config()
        .map_err(|e| format!("Failed to get input config: {}", e))?;

    let sample_rate = config.sample_rate().0;
    let channels = config.channels();

    // PCM buffer for accumulation
    let pcm_buffer: Arc<Mutex<Vec<i16>>> = Arc::new(Mutex::new(Vec::new()));
    let pcm_buffer_clone = pcm_buffer.clone();

    let is_paused = state.is_paused.clone();

    // Build input stream that accumulates PCM samples
    let stream = device
        .build_input_stream(
            &config.into(),
            move |data: &[f32], _: &cpal::InputCallbackInfo| {
                if is_paused.load(Ordering::SeqCst) {
                    return;
                }
                // Convert f32 samples to i16 PCM
                let samples: Vec<i16> = data.iter().map(|&s| (s * 32767.0) as i16).collect();
                if let Ok(mut buf) = pcm_buffer_clone.lock() {
                    buf.extend_from_slice(&samples);
                }
            },
            move |err| {
                eprintln!("Audio capture error: {}", err);
            },
            None,
        )
        .map_err(|e| format!("Failed to build input stream: {}", e))?;

    stream
        .play()
        .map_err(|e| format!("Failed to start stream: {}", e))?;

    state.is_recording.store(true, Ordering::SeqCst);
    state.is_paused.store(false, Ordering::SeqCst);

    // Store stream handle
    if let Ok(mut guard) = state.stream_handle.lock() {
        *guard = Some(StreamWrapper(stream));
    }

    // Spawn background task to send chunks via WebSocket
    let is_rec = state.is_recording.clone();
    let is_pau = state.is_paused.clone();
    let buf = pcm_buffer.clone();

    tokio::spawn(async move {
        use futures_util::SinkExt;
        use tokio_tungstenite::connect_async;

        let ws_url = format!(
            "{}?job_id={}&sample_rate={}&channels={}",
            WS_URL, job_id, sample_rate, channels
        );
        let connect_result = connect_async(&ws_url).await;
        let (mut ws_stream, _) = match connect_result {
            Ok(conn) => conn,
            Err(e) => {
                eprintln!("WebSocket connection failed: {}", e);
                is_rec.store(false, Ordering::SeqCst);
                return;
            }
        };

        let interval = std::time::Duration::from_millis(CHUNK_DURATION_MS);
        while is_rec.load(Ordering::SeqCst) {
            tokio::time::sleep(interval).await;

            if is_pau.load(Ordering::SeqCst) {
                continue;
            }

            let chunk: Vec<u8> = if let Ok(mut buffer) = buf.lock() {
                let samples: Vec<i16> = buffer.drain(..).collect();
                // Convert i16 to little-endian bytes
                samples.iter().flat_map(|s| s.to_le_bytes()).collect()
            } else {
                continue;
            };

            if chunk.is_empty() {
                continue;
            }

            // Send as binary WebSocket frame
            let msg = tokio_tungstenite::tungstenite::Message::Binary(chunk.into());
            if ws_stream.send(msg).await.is_err() {
                eprintln!("WebSocket send failed, stopping");
                break;
            }
        }

        // Send close frame
        let close = tokio_tungstenite::tungstenite::Message::Close(None);
        let _ = ws_stream.send(close).await;
    });

    Ok(format!(
        "Recording started: {}Hz, {} channels",
        sample_rate, channels
    ))
}

#[tauri::command]
pub async fn stop_recording(state: State<'_, AudioCaptureState>) -> Result<String, String> {
    if !state.is_recording.load(Ordering::SeqCst) {
        return Ok("Not recording".to_string());
    }

    state.is_recording.store(false, Ordering::SeqCst);
    state.is_paused.store(false, Ordering::SeqCst);

    // Drop the stream to stop capture
    if let Ok(mut guard) = state.stream_handle.lock() {
        *guard = None;
    }

    Ok("Recording stopped".to_string())
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
