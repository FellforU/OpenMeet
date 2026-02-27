use std::io::Write;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{Manager, State};

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
    // Full recording buffer for WAV export
    all_samples: Arc<Mutex<Vec<i16>>>,
    rec_sample_rate: Mutex<u32>,
    rec_channels: Mutex<u16>,
}

impl AudioCaptureState {
    pub fn new() -> Self {
        Self {
            is_recording: Arc::new(AtomicBool::new(false)),
            is_paused: Arc::new(AtomicBool::new(false)),
            stream_handle: Mutex::new(None),
            all_samples: Arc::new(Mutex::new(Vec::new())),
            rec_sample_rate: Mutex::new(16000),
            rec_channels: Mutex::new(1),
        }
    }
}

#[derive(serde::Serialize)]
pub struct AudioDeviceInfo {
    pub name: String,
    pub sample_rate: u32,
    pub channels: u16,
}

/// Write PCM i16 samples as a WAV file
fn write_wav(path: &PathBuf, samples: &[i16], sample_rate: u32, channels: u16) -> Result<(), String> {
    let data_len = (samples.len() * 2) as u32;
    let file_len = 36 + data_len;
    let byte_rate = sample_rate * (channels as u32) * 2;
    let block_align = channels * 2;

    let mut file = std::fs::File::create(path)
        .map_err(|e| format!("Failed to create WAV file: {}", e))?;

    // RIFF header
    file.write_all(b"RIFF").map_err(|e| e.to_string())?;
    file.write_all(&file_len.to_le_bytes()).map_err(|e| e.to_string())?;
    file.write_all(b"WAVE").map_err(|e| e.to_string())?;

    // fmt chunk
    file.write_all(b"fmt ").map_err(|e| e.to_string())?;
    file.write_all(&16u32.to_le_bytes()).map_err(|e| e.to_string())?; // chunk size
    file.write_all(&1u16.to_le_bytes()).map_err(|e| e.to_string())?; // PCM format
    file.write_all(&channels.to_le_bytes()).map_err(|e| e.to_string())?;
    file.write_all(&sample_rate.to_le_bytes()).map_err(|e| e.to_string())?;
    file.write_all(&byte_rate.to_le_bytes()).map_err(|e| e.to_string())?;
    file.write_all(&block_align.to_le_bytes()).map_err(|e| e.to_string())?;
    file.write_all(&16u16.to_le_bytes()).map_err(|e| e.to_string())?; // bits per sample

    // data chunk
    file.write_all(b"data").map_err(|e| e.to_string())?;
    file.write_all(&data_len.to_le_bytes()).map_err(|e| e.to_string())?;

    // PCM samples as little-endian i16
    for sample in samples {
        file.write_all(&sample.to_le_bytes()).map_err(|e| e.to_string())?;
    }

    file.flush().map_err(|e| e.to_string())?;
    Ok(())
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

    // Store recording parameters
    if let Ok(mut sr) = state.rec_sample_rate.lock() {
        *sr = sample_rate;
    }
    if let Ok(mut ch) = state.rec_channels.lock() {
        *ch = channels;
    }

    // Clear the full recording buffer
    if let Ok(mut all) = state.all_samples.lock() {
        all.clear();
    }

    // PCM buffer for WebSocket streaming
    let pcm_buffer: Arc<Mutex<Vec<i16>>> = Arc::new(Mutex::new(Vec::new()));
    let pcm_buffer_clone = pcm_buffer.clone();

    let is_paused = state.is_paused.clone();
    let all_samples = state.all_samples.clone();

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
                // Accumulate for WebSocket streaming
                if let Ok(mut buf) = pcm_buffer_clone.lock() {
                    buf.extend_from_slice(&samples);
                }
                // Accumulate for full recording WAV export
                if let Ok(mut all) = all_samples.lock() {
                    all.extend_from_slice(&samples);
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
                // Do NOT set is_recording=false here — audio capture should
                // continue so the WAV file is still saved when the user stops.
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
pub async fn stop_recording(
    app: tauri::AppHandle,
    state: State<'_, AudioCaptureState>,
) -> Result<String, String> {
    // Always attempt to stop and save — even if is_recording was cleared
    // (e.g. by a WebSocket failure), samples may still have been captured.
    state.is_recording.store(false, Ordering::SeqCst);
    state.is_paused.store(false, Ordering::SeqCst);

    // Drop the stream to stop capture
    if let Ok(mut guard) = state.stream_handle.lock() {
        *guard = None;
    }

    // Get recording parameters
    let sample_rate = state.rec_sample_rate.lock().map(|sr| *sr).unwrap_or(16000);
    let channels = state.rec_channels.lock().map(|ch| *ch).unwrap_or(1);

    // Extract all recorded samples
    let samples: Vec<i16> = if let Ok(mut all) = state.all_samples.lock() {
        std::mem::take(&mut *all)
    } else {
        Vec::new()
    };

    if samples.is_empty() {
        return Ok(String::new());
    }

    // Create recordings directory under app data dir
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;
    let recordings_dir = data_dir.join("recordings");
    std::fs::create_dir_all(&recordings_dir)
        .map_err(|e| format!("Failed to create recordings dir: {}", e))?;

    // Generate filename with timestamp
    let timestamp = chrono::Local::now().format("%Y%m%d_%H%M%S");
    let filename = format!("{}.wav", timestamp);
    let wav_path = recordings_dir.join(&filename);

    // Write WAV file
    write_wav(&wav_path, &samples, sample_rate, channels)?;

    let path_str = wav_path.to_string_lossy().to_string();
    Ok(path_str)
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

/// Read PCM i16 samples from a WAV file (skipping the 44-byte header)
fn read_wav_samples(path: &PathBuf) -> Result<(Vec<i16>, u32, u16), String> {
    let data = std::fs::read(path)
        .map_err(|e| format!("Failed to read WAV file: {}", e))?;
    if data.len() < 44 {
        return Err("Invalid WAV file: too short".to_string());
    }
    let channels = u16::from_le_bytes([data[22], data[23]]);
    let sample_rate = u32::from_le_bytes([data[24], data[25], data[26], data[27]]);
    let pcm_data = &data[44..];
    let samples: Vec<i16> = pcm_data
        .chunks_exact(2)
        .map(|chunk| i16::from_le_bytes([chunk[0], chunk[1]]))
        .collect();
    Ok((samples, sample_rate, channels))
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
    let (mut all_samples, sample_rate, channels) = read_wav_samples(&first_path)?;

    for p in &paths[1..] {
        let path = PathBuf::from(p);
        let (samples, _, _) = read_wav_samples(&path)?;
        all_samples.extend_from_slice(&samples);
    }

    // Write merged WAV to the first file's location (overwrite)
    write_wav(&first_path, &all_samples, sample_rate, channels)?;

    // Remove subsequent files
    for p in &paths[1..] {
        std::fs::remove_file(p).ok();
    }

    Ok(first_path.to_string_lossy().to_string())
}
