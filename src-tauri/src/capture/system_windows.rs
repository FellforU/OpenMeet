use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use super::types::{CaptureHandle, CaptureResult, PcmBuffer};

/// Capture system audio on Windows via WASAPI loopback.
/// cpal automatically sets AUDCLNT_STREAMFLAGS_LOOPBACK when
/// build_input_stream() is called on an output device.
pub fn start_system_capture(
    is_paused: Arc<AtomicBool>,
    ws_buffer: PcmBuffer,
    all_buffer: PcmBuffer,
) -> CaptureResult<(CaptureHandle, u32, u16)> {
    let host = cpal::default_host();
    let device = host
        .default_output_device()
        .ok_or_else(|| "No output device available for loopback capture".to_string())?;

    let config = device
        .default_input_config()
        .map_err(|e| format!("Failed to get loopback config: {}", e))?;

    let sample_rate = config.sample_rate();
    let channels = config.channels();

    let stream = device
        .build_input_stream(
            &config.into(),
            move |data: &[f32], _: &cpal::InputCallbackInfo| {
                if is_paused.load(Ordering::SeqCst) {
                    return;
                }
                let samples: Vec<i16> = data.iter().map(|&s| (s * 32767.0) as i16).collect();
                ws_buffer.push_samples(&samples);
                all_buffer.push_samples(&samples);
            },
            move |err| {
                eprintln!("WASAPI loopback error: {}", err);
            },
            None,
        )
        .map_err(|e| format!("Failed to build loopback stream: {}", e))?;

    stream
        .play()
        .map_err(|e| format!("Failed to start loopback stream: {}", e))?;

    Ok((CaptureHandle::new(stream), sample_rate, channels))
}
