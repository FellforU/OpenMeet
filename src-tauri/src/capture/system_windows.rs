use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use super::types::{CaptureHandle, CaptureResult, PcmBuffer};

/// Capture system audio on Windows via WASAPI loopback.
/// cpal automatically sets AUDCLNT_STREAMFLAGS_LOOPBACK when
/// build_input_stream() is called on an output (render) device.
///
/// Key: must use default_output_config() (NOT default_input_config())
/// because cpal's WASAPI backend rejects input config queries on render devices.
pub fn start_system_capture(
    is_paused: Arc<AtomicBool>,
    ws_buffer: PcmBuffer,
    all_buffer: PcmBuffer,
) -> CaptureResult<(CaptureHandle, u32, u16)> {
    let host = cpal::default_host();
    let device = host
        .default_output_device()
        .ok_or_else(|| "No output device available for loopback capture".to_string())?;

    // Must use output config — cpal WASAPI returns StreamTypeNotSupported
    // for default_input_config() on render (output) devices.
    let config = device
        .default_output_config()
        .map_err(|e| format!("Failed to get loopback config: {}", e))?;

    let sample_rate = config.sample_rate();
    let channels = config.channels();

    eprintln!(
        "WASAPI loopback: device={:?}, rate={}, ch={}, fmt={:?}",
        device.description().unwrap_or_default(),
        sample_rate,
        channels,
        config.sample_format()
    );

    // build_input_stream on a render device triggers WASAPI loopback automatically
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
