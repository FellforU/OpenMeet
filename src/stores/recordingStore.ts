import { create } from "zustand";
import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { toast } from "sonner";
import i18n from "../i18n";
import * as api from "../services/asrClient";
import { useTranscriptionStore } from "./transcriptionStore";
import { useProjectStore } from "./projectStore";
import { generateMeetingTitle, generateMeetingSummary } from "../services/llmClient";
import type { Segment } from "../types";

type RecordingStatus = "idle" | "recording" | "paused";
type ProcessingStep =
  | "saving"
  | "merging"
  | "loading"
  | "titling"
  | "summarizing"
  | null;

export type AudioSource = "microphone" | "system";

interface RecordingStore {
  status: RecordingStatus;
  jobId: string | null;
  elapsed: number;
  segments: Segment[];
  processingStep: ProcessingStep;
  audioSource: AudioSource;

  setAudioSource: (source: AudioSource) => void;
  startRecording: (engine: string, modelSize: string, language: string | null) => Promise<void>;
  pauseRecording: () => Promise<void>;
  resumeRecording: () => Promise<void>;
  stopRecording: () => Promise<void>;
  addSegment: (segment: Segment) => void;
  reset: () => void;
}

let elapsedTimer: ReturnType<typeof setInterval> | null = null;
let wsConnection: WebSocket | null = null;

function clearElapsedTimer() {
  if (elapsedTimer) {
    clearInterval(elapsedTimer);
    elapsedTimer = null;
  }
}

function closeWebSocket() {
  if (wsConnection) {
    wsConnection.close();
    wsConnection = null;
  }
}

/** Check if a string looks like an absolute file path (not an error message) */
function isFilePath(s: string): boolean {
  return s.startsWith("/") || /^[A-Za-z]:[/\\]/.test(s);
}

const t = (key: string, opts?: Record<string, string>) =>
  i18n.t(key, opts);

/**
 * Try to load audio via asset protocol; fall back to base64 blob if that fails.
 * Returns the usable object URL, or null on complete failure.
 */
async function loadAudioUrl(audioPath: string): Promise<string | null> {
  // 1. Try Tauri asset protocol (zero-copy, fast)
  try {
    const assetUrl = convertFileSrc(audioPath);
    const ok = await new Promise<boolean>((resolve) => {
      const probe = new Audio();
      probe.onloadedmetadata = () => {
        probe.src = "";
        resolve(true);
      };
      probe.onerror = () => resolve(false);
      probe.src = assetUrl;
    });
    if (ok) return assetUrl;
  } catch {
    // convertFileSrc unavailable outside Tauri
  }

  // 2. Fallback: read file as base64 via Rust IPC
  try {
    const base64 = await invoke<string>("read_audio_file", { path: audioPath });
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    const blob = new Blob([bytes], { type: "audio/wav" });
    return URL.createObjectURL(blob);
  } catch {
    return null;
  }
}

export const useRecordingStore = create<RecordingStore>((set, get) => ({
  status: "idle",
  jobId: null,
  elapsed: 0,
  segments: [],
  processingStep: null,
  audioSource: "microphone" as AudioSource,

  setAudioSource: (source) => set({ audioSource: source }),

  startRecording: async (engine, modelSize, language) => {
    // Auto-create a meeting if none is selected
    let activeProjectId = useProjectStore.getState().activeProjectId;
    if (!activeProjectId) {
      const now = new Date();
      const timeStr = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
      const project = await useProjectStore.getState().addProject(`新会议 ${timeStr}`);
      activeProjectId = project.id;
    } else {
      // If the active item is a folder, also create a new meeting inside it
      const activeItem = useProjectStore.getState().projects.find(
        (p) => p.id === activeProjectId
      );
      if (activeItem?.isFolder) {
        const now = new Date();
        const timeStr = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
        const project = await useProjectStore.getState().addProject(`新会议 ${timeStr}`, activeProjectId);
        activeProjectId = project.id;
      }
    }

    // Create a job for streaming
    const job = await api.createJob({
      mode: "stream",
      engine,
      model_size: modelSize,
      language,
    });

    set({ jobId: job.id, status: "recording", elapsed: 0, segments: [] });

    // Start elapsed timer
    clearElapsedTimer();
    elapsedTimer = setInterval(() => {
      set({ elapsed: get().elapsed + 1 });
    }, 1000);

    // Connect to WebSocket for receiving segments
    const wsUrl = `ws://127.0.0.1:18090/ws/stream?job_id=${job.id}&sample_rate=16000&channels=1`;
    wsConnection = new WebSocket(wsUrl);
    wsConnection.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === "segment") {
          const segment: Segment = {
            id: `seg-${data.index}`,
            start: data.start,
            end: data.end,
            text: data.text,
            speaker: data.speaker || null,
            confidence: data.confidence || null,
          };
          get().addSegment(segment);
        }
      } catch {
        // Ignore parse errors
      }
    };

    // Start audio capture in Rust
    try {
      await invoke<string>("start_recording", { jobId: job.id, audioSource: get().audioSource });
    } catch {
      // If Tauri invoke fails (e.g., in dev browser), recording UI still works
    }
  },

  pauseRecording: async () => {
    clearElapsedTimer();
    set({ status: "paused" });

    try {
      await invoke<string>("pause_recording");
    } catch {
      // Ignore if not in Tauri
    }

    const { jobId } = get();
    if (jobId) {
      try {
        await api.pauseJob(jobId);
      } catch {
        // Ignore API errors
      }
    }
  },

  resumeRecording: async () => {
    set({ status: "recording" });

    clearElapsedTimer();
    elapsedTimer = setInterval(() => {
      set({ elapsed: get().elapsed + 1 });
    }, 1000);

    try {
      await invoke<string>("resume_recording");
    } catch {
      // Ignore if not in Tauri
    }

    const { jobId } = get();
    if (jobId) {
      try {
        await api.resumeJob(jobId);
      } catch {
        // Ignore API errors
      }
    }
  },

  stopRecording: async () => {
    clearElapsedTimer();
    closeWebSocket();

    const { segments, jobId, elapsed: recordedSeconds } = get();
    set({ status: "idle", jobId: null, elapsed: 0, segments: [], processingStep: "saving" });

    const activeProjectId = useProjectStore.getState().activeProjectId;
    const transcriptionStore = useTranscriptionStore.getState();
    const existingSegments = transcriptionStore.segments;

    // Sync segments to transcription store — append if segments already exist
    if (segments.length > 0) {
      if (existingSegments.length > 0) {
        transcriptionStore.appendSegments(segments);
      } else {
        transcriptionStore.setSegments(segments);
      }
      transcriptionStore.setJobStatus("completed");

      // Persist segments to SQLite
      if (activeProjectId) {
        try {
          await useTranscriptionStore.getState().persistSegments(activeProjectId);
        } catch {
          toast.error(t("error.segmentSaveFailed"));
        }
      }
    } else if (recordedSeconds >= 3) {
      // No segments after a meaningful recording duration — warn user
      toast.warning(t("error.noSegments"));
    }

    // Stop audio capture in Rust and get saved WAV path
    let audioPath: string | null = null;
    try {
      const result = await invoke<string>("stop_recording");
      // Validate the result is a real file path, not an error message
      if (result && result.length > 0 && isFilePath(result)) {
        audioPath = result;
      }
    } catch {
      toast.error(t("error.audioSaveFailed"));
    }

    // Merge audio files if project already has an audio path
    if (activeProjectId && audioPath) {
      const activeProject = useProjectStore.getState().projects.find(
        (p) => p.id === activeProjectId
      );
      if (activeProject?.audioPath) {
        set({ processingStep: "merging" });
        try {
          const merged = await invoke<string>("merge_wav_files", {
            paths: [activeProject.audioPath, audioPath],
          });
          audioPath = merged;
        } catch {
          toast.warning(t("error.audioMergeFailed"));
        }
      }
      await useProjectStore.getState().updateProject(activeProjectId, { audioPath });
    }

    // Persist durationMs from segments (even when audio capture failed)
    if (activeProjectId) {
      const currentSegments = useTranscriptionStore.getState().segments;
      if (currentSegments.length > 0) {
        const durationMs = Math.round(
          currentSegments[currentSegments.length - 1].end * 1000
        );
        await useProjectStore.getState().updateProject(activeProjectId, { durationMs });
      }
    }

    // Load audio file for playback
    if (audioPath) {
      set({ processingStep: "loading" });
      const loaded = await loadAudioUrl(audioPath);
      if (loaded) {
        useTranscriptionStore.getState().setAudioFile(audioPath, loaded);
      } else {
        toast.error(t("error.audioLoadFailed"));
      }
    }

    // Auto-generate AI title for the active meeting (only first recording)
    if (activeProjectId && segments.length > 0 && existingSegments.length === 0) {
      set({ processingStep: "titling" });
      const activeProject = useProjectStore.getState().projects.find(
        (p) => p.id === activeProjectId
      );
      if (activeProject && !activeProject.isFolder) {
        const transcriptText = segments.map((s) => s.text).join(" ");
        try {
          const title = await generateMeetingTitle(activeProject.createdAt, transcriptText);
          await useProjectStore.getState().updateProject(activeProjectId, { title });
        } catch {
          toast.warning(t("error.titleGenerateFailed"));
        }
      }
    }

    // Auto-generate meeting summary
    const finalSegments = useTranscriptionStore.getState().segments;
    if (activeProjectId && finalSegments.length > 0) {
      set({ processingStep: "summarizing" });
      const transcriptText = finalSegments
        .map((s) => (s.speaker ? `[${s.speaker}] ${s.text}` : s.text))
        .join("\n");
      try {
        const summary = await generateMeetingSummary(transcriptText);
        useTranscriptionStore.getState().setSummary(summary);
        await useTranscriptionStore.getState().persistSummary(activeProjectId);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        toast.error(t("error.summaryFailed", { message: msg }));
      }
    }

    // Done processing
    set({ processingStep: null });

    // Cancel the ASR job in background
    if (jobId) {
      api.cancelJob(jobId).catch(() => {});
    }
  },

  addSegment: (segment) => {
    set({ segments: [...get().segments, segment] });
  },

  reset: () => {
    clearElapsedTimer();
    closeWebSocket();
    set({ status: "idle", jobId: null, elapsed: 0, segments: [], processingStep: null });
  },
}));
