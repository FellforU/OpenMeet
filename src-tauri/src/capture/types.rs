use std::sync::{Arc, Mutex};

/// Audio source selection
#[derive(Debug, Clone, Copy, PartialEq, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AudioSourceType {
    Microphone,
    System,
    Mixed,
}

impl Default for AudioSourceType {
    fn default() -> Self {
        Self::Microphone
    }
}

impl AudioSourceType {
    pub fn from_str_opt(s: Option<&str>) -> Self {
        match s {
            Some("system") => Self::System,
            Some("mixed") => Self::Mixed,
            _ => Self::Microphone,
        }
    }
}

/// Thread-safe PCM sample buffer shared between capture callback and consumer
#[derive(Clone)]
pub struct PcmBuffer {
    inner: Arc<Mutex<Vec<i16>>>,
}

impl PcmBuffer {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(Mutex::new(Vec::new())),
        }
    }

    pub fn push_samples(&self, samples: &[i16]) {
        if let Ok(mut buf) = self.inner.lock() {
            buf.extend_from_slice(samples);
        }
    }

    pub fn drain(&self) -> Vec<i16> {
        if let Ok(mut buf) = self.inner.lock() {
            buf.drain(..).collect()
        } else {
            Vec::new()
        }
    }

    pub fn clear(&self) {
        if let Ok(mut buf) = self.inner.lock() {
            buf.clear();
        }
    }
}

/// Opaque handle to a running capture stream.
/// Dropping it stops capture.
pub struct CaptureHandle {
    _inner: Box<dyn std::any::Any + Send>,
}

impl CaptureHandle {
    pub fn new<T: std::any::Any + Send + 'static>(inner: T) -> Self {
        Self {
            _inner: Box::new(inner),
        }
    }
}

/// Common result type for capture operations
pub type CaptureResult<T> = Result<T, String>;
