use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use screencapturekit::sc_shareable_content::SCShareableContent;
use screencapturekit::sc_stream::SCStream;
use screencapturekit::sc_stream_configuration::SCStreamConfiguration;
use screencapturekit::sc_content_filter::SCContentFilter;
use screencapturekit::sc_output_handler::{SCStreamOutputType, SCStreamOutputTrait};
use screencapturekit::cm::CMSampleBuffer;

use super::types::{CaptureHandle, CaptureResult, PcmBuffer};

struct AudioHandler {
    is_paused: Arc<AtomicBool>,
    ws_buffer: PcmBuffer,
    all_buffer: PcmBuffer,
}

impl SCStreamOutputTrait for AudioHandler {
    fn did_output_sample_buffer(
        &self,
        sample_buffer: CMSampleBuffer,
        of_type: SCStreamOutputType,
    ) {
        if of_type != SCStreamOutputType::Audio {
            return;
        }
        if self.is_paused.load(Ordering::SeqCst) {
            return;
        }

        // Extract audio data from CMSampleBuffer
        if let Some(audio_buffers) = sample_buffer.audio_buffer_list() {
            for buffer in audio_buffers {
                // Audio data is f32 PCM from ScreenCaptureKit
                let float_samples: &[f32] = unsafe {
                    std::slice::from_raw_parts(
                        buffer.data as *const f32,
                        buffer.data_bytes_size as usize / std::mem::size_of::<f32>(),
                    )
                };
                let samples: Vec<i16> = float_samples
                    .iter()
                    .map(|&s| (s.clamp(-1.0, 1.0) * 32767.0) as i16)
                    .collect();
                self.ws_buffer.push_samples(&samples);
                self.all_buffer.push_samples(&samples);
            }
        }
    }
}

pub fn start_system_capture(
    is_paused: Arc<AtomicBool>,
    ws_buffer: PcmBuffer,
    all_buffer: PcmBuffer,
) -> CaptureResult<(CaptureHandle, u32, u16)> {
    let content = SCShareableContent::get()
        .map_err(|e| format!("Failed to get shareable content (Screen Recording permission required): {:?}", e))?;

    let displays = content.displays();
    let display = displays
        .first()
        .ok_or_else(|| "No display found".to_string())?
        .clone();

    let filter = SCContentFilter::create()
        .with_display(&display)
        .with_excluding_windows(&[])
        .build();

    let sample_rate: u32 = 48000;
    let channels: u16 = 1;

    let config = SCStreamConfiguration::new()
        .with_captures_audio(true)
        .with_width(1)   // Minimal video (required by API)
        .with_height(1)
        .with_sample_rate(sample_rate)
        .with_channel_count(channels as u32);

    let mut stream = SCStream::new(&filter, &config);

    let handler = AudioHandler {
        is_paused,
        ws_buffer,
        all_buffer,
    };

    stream.add_output_handler(handler, SCStreamOutputType::Audio);

    stream
        .start_capture()
        .map_err(|e| format!("Failed to start ScreenCaptureKit stream: {:?}", e))?;

    Ok((CaptureHandle::new(stream), sample_rate, channels))
}
