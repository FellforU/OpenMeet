use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use super::types::{CaptureHandle, CaptureResult, PcmBuffer};

/// Start microphone capture using the default input device.
/// Returns a CaptureHandle — dropping it stops the stream.
pub fn start_mic_capture(
    is_paused: Arc<AtomicBool>,
    ws_buffer: PcmBuffer,
    all_buffer: PcmBuffer,
) -> CaptureResult<(CaptureHandle, u32, u16)> {
    let host = cpal::default_host();
    let device = host
        .default_input_device()
        .ok_or_else(|| "No input device available".to_string())?;

    let config = device
        .default_input_config()
        .map_err(|e| format!("Failed to get input config: {}", e))?;

    let sample_rate = config.sample_rate();
    let channels = config.channels();

    let stream = device
        .build_input_stream(
            &config.into(),
            move |data: &[f32], _: &cpal::InputCallbackInfo| {
                if is_paused.load(Ordering::SeqCst) {
                    return;
                }
                let samples: Vec<i16> = data
                    .iter()
                    .map(|&s| (s.clamp(-1.0, 1.0) * 32767.0) as i16)
                    .collect();
                ws_buffer.push_samples(&samples);
                all_buffer.push_samples(&samples);
            },
            move |err| {
                eprintln!("Microphone capture error: {}", err);
            },
            None,
        )
        .map_err(|e| format!("Failed to build input stream: {}", e))?;

    stream
        .play()
        .map_err(|e| format!("Failed to start mic stream: {}", e))?;

    Ok((CaptureHandle::new(stream), sample_rate, channels))
}
