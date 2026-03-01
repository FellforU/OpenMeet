# UI Bug Fixes Design — 2026-03-01

## Overview

Fix 6 UI issues related to transcription state management, summary navigation, recording mode, and progress display.

## Root Cause Analysis

Bugs 3/5/6 share the same root cause: `transcriptionStore.loadProjectData()` does not fully reset stale state (`job.*`, `audio.duration`, `audio.currentTime`) when switching or creating meetings.

## Bug 1: Summary Jump Should Scroll to Segment

**Problem:** Clicking a discussion item's jump icon only seeks audio and switches to transcript tab, but doesn't scroll to the corresponding segment.

**Solution:**
- Add `highlightSegmentTime: number | null` to `transcriptionStore`
- `seekTo(time)` also sets `highlightSegmentTime = time`
- `TranscriptPanel` uses `data-start-time` attributes on segment elements
- When `highlightSegmentTime` changes, find matching segment, call `scrollIntoView({ behavior: "smooth", block: "center" })`, add highlight class
- Auto-clear highlight after 3 seconds

## Bug 2: Microphone vs System Audio Recording

**Problem:** Only one audio source is supported.

**Solution (skeleton only — Rust capture logic deferred):**
- Add `audioSource: "microphone" | "system"` to `recordingStore` (default: `"microphone"`)
- RecordButton: add a dropdown chevron next to the record button for source selection
- Pass `audioSource` to Rust `start_recording` command as a new parameter
- Rust `start_recording`: accept `audio_source: String` parameter (stub — currently uses default device regardless)

## Bug 3: Transcription Content Disappears After Switching Meeting

**Problem:** `loadProjectData` overwrites `segments`/`summary` but leaves `job.status` stale (e.g. `"running"`), causing TranscriptPanel to show wrong state.

**Solution:** At the start of `loadProjectData`, reset all transient state before loading new data:
```typescript
set({
  job: { id: null, mode: "file", status: "idle", progress: 0, pipelineStep: null },
  segments: [],
  summary: null,
  audio: { ...initialAudioState, playbackSpeed: get().audio.playbackSpeed },
});
```

## Bug 4: Transcription Progress in Center of Workspace

**Problem:** Progress is only shown in the small StatusBar at the bottom.

**Solution:** In `TranscriptPanel`, when `job.status` is `"running"` or `"post_processing"`, render a prominent progress section above the segment list:
- Large step name text (e.g. "正在转录...", "标点恢复中...")
- Progress percentage with progress bar
- 5-step pipeline indicator (reuse PipelineStatus logic)
- Real-time segments scroll below

StatusBar retains its compact progress display.

## Bug 5: Audio Duration Not Updating on Meeting Switch

**Problem:** `audio.duration` retains old value until new audio's `onLoadedMetadata` fires.

**Solution:** Fixed by Bug 3's unified reset — `audio` state is reset to initial values (duration: 0, currentTime: 0) at the start of `loadProjectData`. Playback speed preference is preserved.

## Bug 6: New Meeting UI Not Updated

**Problem:** `addProject()` sets `activeProjectId` but doesn't trigger transcription state reset.

**Solution:** After `addProject()` sets `activeProjectId`, call `transcriptionStore.loadProjectData(newProjectId)`. Since new meetings have no data, the reset + empty DB load produces a clean empty state.

## Files to Modify

| File | Changes |
|------|---------|
| `src/stores/transcriptionStore.ts` | Add `highlightSegmentTime`, reset logic in `loadProjectData`, update `seekTo` |
| `src/stores/projectStore.ts` | Call `loadProjectData` after `addProject` |
| `src/stores/recordingStore.ts` | Add `audioSource` state + setter |
| `src/components/Workspace/TranscriptPanel.tsx` | Scroll-to-segment on highlight, progress overlay |
| `src/components/Workspace/SummaryPanel.tsx` | No change needed (already passes time correctly) |
| `src/components/ControlBar/RecordButton.tsx` | Add audio source dropdown |
| `src-tauri/src/lib.rs` or recording module | Accept `audio_source` parameter (stub) |
| `src/i18n/locales/{en,zh}/*.json` | New translation keys |
