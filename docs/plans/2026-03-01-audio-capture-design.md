# Audio Capture Cross-Platform Design

Date: 2026-03-01

## Overview

Implement system audio capture and mixed recording across all 5 platforms (Windows, macOS, Linux, Android, iOS), extending the existing microphone-only capture.

## Recording Modes

| Mode | Description | Output |
|------|-------------|--------|
| `microphone` | Default input device via cpal (existing) | Mono PCM |
| `system` | Platform-specific loopback capture | Mono PCM |
| `mixed` | Mic + system simultaneously, dual-track | Stereo PCM (ch0=mic, ch1=system) |

## Architecture

### Module Structure

```
src-tauri/src/
├── audio_capture.rs           # Public API, AudioSourceType enum, dispatch logic
├── capture_cpal.rs            # Desktop microphone (cpal, existing code extracted)
├── capture_wasapi.rs          # Windows system audio (cpal WASAPI loopback)
├── capture_screencapkit.rs    # macOS system audio (screencapturekit-rs)
├── capture_pipewire.rs        # Linux system audio (pipewire-rs + libpulse fallback)
├── capture_ios.rs             # iOS bridge (Swift ReplayKit via Tauri mobile)
└── capture_android.rs         # Android bridge (Kotlin MediaProjection via Tauri mobile)

ios/Sources/                   # Swift: Broadcast Upload Extension
android/src/main/kotlin/       # Kotlin: MediaProjection + AudioPlaybackCapture
```

### Core Abstraction

```rust
pub enum AudioSourceType {
    Microphone,
    System,
    Mixed,
}

pub struct CaptureConfig {
    pub source: AudioSourceType,
    pub sample_rate: u32,
    pub channels: u16,      // 1=mono, 2=stereo (mixed mode)
}
```

### Data Flow

```
                    ┌──────────────┐
   Microphone ────▶ │  mic_buffer  │──┐
   (cpal input)     └──────────────┘  │
                                      ├──▶ interleave ──▶ WebSocket (PCM i16)
   System Audio ──▶ │  sys_buffer  │──┘        │              ↓
   (platform API)   └──────────────┘           │         ASR Service
                                               ▼
                                         WAV Export
                                    (stereo if mixed)
```

- **Single source** (mic or system): mono PCM, same pipeline as existing
- **Mixed mode**: two capture streams, interleaved to stereo every 300ms chunk, WAV export as stereo

## Platform-Specific Implementation

### Windows — cpal WASAPI Loopback

- Call `build_input_stream()` on `default_output_device()` — cpal sets `AUDCLNT_STREAMFLAGS_LOOPBACK` automatically
- Pure Rust, no additional dependencies beyond cpal 0.17
- No permissions required
- **Difficulty: Low**

### macOS — screencapturekit-rs

- Use `screencapturekit` crate (v1.5.0+) for audio-only capture
- Configure: `set_captures_audio(true)`, `set_excludes_current_process_audio(false)`
- Requires Screen Recording permission (system dialog on first use)
- Minimum macOS 12.3
- Pure Rust (crate wraps Objective-C APIs)
- **Difficulty: Medium**

### Linux — pipewire-rs with libpulse fallback

- Runtime detection: check if PipeWire is available
- **PipeWire path**: Create capture stream with `AUTOCONNECT` flag to system output
- **PulseAudio fallback**: Connect to monitor source via `libpulse-binding`
- Requires `libpipewire-dev` or `libpulse-dev` at build time
- No special permissions
- **Difficulty: Medium**

### Android — MediaProjection + AudioPlaybackCapture

- Tauri 2.x mobile plugin with Kotlin native code
- `MediaProjectionManager.createScreenCaptureIntent()` for permission
- `AudioPlaybackCaptureConfiguration` + `AudioRecord` for capture
- Foreground Service to keep capture alive
- PCM data sent back to Rust via Tauri event channel
- Requires: `RECORD_AUDIO`, `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_MEDIA_PROJECTION`
- Minimum Android 10 (API 29)
- **Difficulty: Medium-High**

### iOS — ReplayKit Broadcast Upload Extension

- Separate Broadcast Upload Extension target (independent process)
- Swift `RPBroadcastSampleHandler` receives system + mic audio buffers
- Data transfer to main app via App Group shared container (file-based)
- User must manually start broadcast via `RPSystemBroadcastPickerView`
- Cannot capture DRM-protected audio (AVPlayer, Safari, Music)
- Extension has 50MB memory limit
- Requires: Microphone permission, App Group entitlement
- **Difficulty: High**

## Frontend Changes

### AudioSource Type Extension

```typescript
export type AudioSource = "microphone" | "system" | "mixed";
```

### RecordButton UI

Add third option "Mixed Recording" to dropdown menu with dual-track icon.

### i18n Keys

- `recording.mixed` — "Mixed Recording" / "混合录制"

## Dependency Changes

### Cargo.toml

```toml
cpal = "0.17"                              # Upgrade from 0.15
screencapturekit = "1.5"                   # macOS only (cfg)
pipewire = "0.8"                           # Linux only (cfg)
libpulse-binding = "2.28"                  # Linux fallback (cfg)
```

### Mobile Dependencies

- Android: `androidx.media:media:1.7.0` (MediaProjection)
- iOS: ReplayKit framework (system)

## Permission Handling

| Platform | Permission | Handling |
|----------|-----------|----------|
| Windows | None | Direct access |
| macOS | Screen Recording | System dialog on first use, frontend guidance toast |
| Linux | None | Direct access |
| Android | RECORD_AUDIO + MediaProjection | Runtime permission request |
| iOS | Microphone + App Group | Info.plist declaration |

## Error Handling

- System audio unavailable (permission denied, API not supported): toast notification, auto-fallback to microphone mode
- Mixed mode partial failure: degrade to single source, notify user
- Mobile permission denied: disable option in UI, show settings guidance

## Implementation Phases

### Phase 1: Desktop (Windows + macOS + Linux)
1. Upgrade cpal to 0.17
2. Extract existing mic capture to `capture_cpal.rs`
3. Implement `capture_wasapi.rs` (Windows loopback)
4. Implement `capture_screencapkit.rs` (macOS)
5. Implement `capture_pipewire.rs` (Linux)
6. Implement mixed mode (dual-buffer interleave)
7. Update frontend (AudioSource type, RecordButton, i18n)

### Phase 2: Android
1. Create Tauri mobile plugin structure
2. Implement Kotlin MediaProjection service
3. Bridge PCM data back to Rust layer
4. Permission flow UI

### Phase 3: iOS
1. Create Broadcast Upload Extension target
2. Implement Swift RPBroadcastSampleHandler
3. App Group IPC for audio data transfer
4. Broadcast picker UI integration
