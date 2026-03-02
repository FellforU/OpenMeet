import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { toast } from "sonner";
import i18n from "../i18n";
import * as api from "../services/asrClient";
import { loadAudioUrl } from "../services/audioLoader";
import { useTranscriptionStore } from "./transcriptionStore";
import { useProjectStore } from "./projectStore";
import { generateMeetingTitle, generateMeetingSummary } from "../services/llmClient";
import type { Segment } from "../types";

type RecordingStatus = "idle" | "recording" | "paused";
type ProcessingStep =
  | "saving"
  | "merging"
  | "loading"
  | "loadingModel"
  | "titling"
  | "summarizing"
  | null;

export type AudioSource = "microphone" | "system" | "mixed";

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
let unlistenSegment: UnlistenFn | null = null;

function clearElapsedTimer() {
  if (elapsedTimer) {
    clearInterval(elapsedTimer);
    elapsedTimer = null;
  }
}

function cleanupSegmentListener() {
  if (unlistenSegment) {
    unlistenSegment();
    unlistenSegment = null;
  }
}

/** Check if a string looks like an absolute file path (not an error message) */
function isFilePath(s: string): boolean {
  return s.startsWith("/") || /^[A-Za-z]:[/\\]/.test(s);
}

const t = (key: string, opts?: Record<string, string>) =>
  i18n.t(key, opts);

export const useRecordingStore = create<RecordingStore>((set, get) => ({
  status: "idle",
  jobId: null,
  elapsed: 0,
  segments: [],
  processingStep: null,
  audioSource: "microphone" as AudioSource,

  setAudioSource: (source) => set({ audioSource: source }),

  startRecording: async (engine, modelSize, language) => {
    // Ensure ASR model is loaded before recording starts
    set({ processingStep: "loadingModel" });
    try {
      const loadResp = await api.loadEngineModel(engine, modelSize);
      if (loadResp.status === "loading") {
        // Poll until model is ready
        const MAX_WAIT_MS = 300_000; // 5 minutes
        const POLL_MS = 1_000;
        const start = Date.now();
        while (Date.now() - start < MAX_WAIT_MS) {
          await new Promise((r) => setTimeout(r, POLL_MS));
          const status = await api.getLoadStatus(engine);
          if (status.phase === "ready") break;
          if (status.phase === "error") {
            throw new Error(status.error || "Model load failed");
          }
        }
      }
    } catch (err) {
      set({ processingStep: null });
      throw err;
    }
    set({ processingStep: null });

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

    // Listen for streaming segments from Rust via Tauri events
    // (Rust WS reads segment JSON from ASR service and emits "stream-segment" events)
    cleanupSegmentListener();
    unlistenSegment = await listen<string>("stream-segment", (event) => {
      try {
        const data = JSON.parse(event.payload);
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
    });

    // Start audio capture in Rust (also opens WS to ASR service)
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
    cleanupSegmentListener();

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
      // Force audio player to reload by resetting audio state first
      useTranscriptionStore.getState().setAudioFile("", "");
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
    cleanupSegmentListener();
    set({ status: "idle", jobId: null, elapsed: 0, segments: [], processingStep: null });
  },
}));
