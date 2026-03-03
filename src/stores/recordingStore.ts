import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { toast } from "sonner";
import i18n from "../i18n";
import * as api from "../services/asrClient";
import { loadAudioUrl } from "../services/audioLoader";
import { useTranscriptionStore } from "./transcriptionStore";
import { useProjectStore } from "./projectStore";
import { useSettingsStore } from "./settingsStore";
import { tauriFetch } from "../services/httpProxy";
import { generateMeetingTitle, generateMeetingSummary } from "../services/llmClient";
import type { Segment, VoiceprintMatchResult } from "../types";

type RecordingStatus = "idle" | "recording" | "paused";
type ProcessingStep =
  | "saving"
  | "merging"
  | "loading"
  | "loadingModel"
  | "titling"
  | "diarizing"
  | "summarizing"
  | null;

export type AudioSource = "microphone" | "system" | "mixed";

interface RecordingStore {
  status: RecordingStatus;
  jobId: string | null;
  elapsed: number;
  streamSegmentCount: number;
  segmentCountAtStart: number;
  processingStep: ProcessingStep;
  audioSource: AudioSource;

  setAudioSource: (source: AudioSource) => void;
  startRecording: (engine: string, modelSize: string, language: string | null) => Promise<void>;
  pauseRecording: () => Promise<void>;
  resumeRecording: () => Promise<void>;
  stopRecording: () => Promise<void>;
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
  streamSegmentCount: 0,
  segmentCountAtStart: 0,
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

    // Record how many segments already exist (for first-recording detection)
    const existingCount = useTranscriptionStore.getState().segments.length;

    set({
      jobId: job.id,
      status: "recording",
      elapsed: 0,
      streamSegmentCount: 0,
      segmentCountAtStart: existingCount,
    });

    // Start elapsed timer
    clearElapsedTimer();
    elapsedTimer = setInterval(() => {
      set({ elapsed: get().elapsed + 1 });
    }, 1000);

    // Listen for streaming segments from Rust via Tauri events
    // Write directly to transcriptionStore for immediate UI display
    cleanupSegmentListener();
    unlistenSegment = await listen<string>("stream-segment", (event) => {
      try {
        const data = JSON.parse(event.payload);
        if (data.type === "segment") {
          const count = get().streamSegmentCount;
          const segment: Segment = {
            id: crypto.randomUUID(),
            start: data.start,
            end: data.end,
            text: data.text,
            speaker: data.speaker || null,
            confidence: data.confidence || null,
          };
          useTranscriptionStore.getState().addStreamSegment(segment);
          set({ streamSegmentCount: count + 1 });
        }
      } catch {
        // Ignore parse errors
      }
    });

    // Start auto-persist timer (saves segments to SQLite every 30s for crash recovery)
    if (activeProjectId) {
      useTranscriptionStore.getState().startAutoPersist(activeProjectId);
    }

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

    // Stop auto-persist
    useTranscriptionStore.getState().stopAutoPersist();

    // Capture values before clearing state — these are used later in the flow
    const capturedJobId = get().jobId;
    const recordedSeconds = get().elapsed;
    const capturedSegmentCountAtStart = get().segmentCountAtStart;
    set({ status: "idle", jobId: null, elapsed: 0, streamSegmentCount: 0, processingStep: "saving" });

    const activeProjectId = useProjectStore.getState().activeProjectId;
    const isFirstRecording = capturedSegmentCountAtStart === 0;

    // Stop audio capture in Rust FIRST — this closes WebSocket to Python ASR service
    let audioPath: string | null = null;
    try {
      const cacheDir = useSettingsStore.getState().general.cacheDir || undefined;
      const result = await invoke<string>("stop_recording", { cacheDir });
      if (result && result.length > 0 && isFilePath(result)) {
        audioPath = result;
      }
    } catch {
      toast.error(t("error.audioSaveFailed"));
    }

    // Wait for the streaming ASR job to finish processing remaining audio.
    // Python's finally block transcribes buffered audio after WebSocket closes,
    // which takes a few hundred ms to a few seconds depending on model.
    if (capturedJobId) {
      const MAX_WAIT_MS = 15_000;
      const POLL_MS = 300;
      const start = Date.now();
      while (Date.now() - start < MAX_WAIT_MS) {
        try {
          const jobResp = await api.getJob(capturedJobId);
          if (jobResp.status === "completed" || jobResp.status === "ready" ||
              jobResp.status === "cancelled") {
            break;
          }
        } catch {
          // Network error — retry
        }
        await new Promise((r) => setTimeout(r, POLL_MS));
      }

      // Fetch final segments from the completed job (includes audio processed
      // in Python's finally block that couldn't be sent via closed WebSocket)
      try {
        const result = await tauriFetch(
          `http://127.0.0.1:18090/jobs/${capturedJobId}/result`,
          { method: "GET" }
        );
        if (result.status >= 200 && result.status < 300) {
          const data = JSON.parse(result.body);
          if (Array.isArray(data.segments) && data.segments.length > 0) {
            const finalSegments: Segment[] = data.segments.map(
              (s: { start: number; end: number; text: string; speaker: string | null; confidence: number | null }) => ({
                id: crypto.randomUUID(),
                start: s.start,
                end: s.end,
                text: s.text,
                speaker: s.speaker || null,
                confidence: s.confidence || null,
              })
            );
            // Merge: keep pre-existing segments, replace current session's portion
            const allSegments = useTranscriptionStore.getState().segments;
            const previousSegments = allSegments.slice(0, capturedSegmentCountAtStart);
            const mergedSegments = [...previousSegments, ...finalSegments];
            useTranscriptionStore.getState().setSegments(mergedSegments);
          }
        }
      } catch {
        // Fall through to use whatever segments we already have from streaming
      }
    }

    // NOW check segments — after ASR service has finished processing
    const segments = useTranscriptionStore.getState().segments;

    if (segments.length > 0) {
      useTranscriptionStore.getState().setJobStatus("completed");

      // Persist segments to SQLite
      if (activeProjectId) {
        try {
          await useTranscriptionStore.getState().persistSegments(activeProjectId);
        } catch {
          toast.error(t("error.segmentSaveFailed"));
        }
      }
    } else if (recordedSeconds >= 3) {
      // No segments after ASR finished — warn user
      toast.warning(t("error.noSegments"));
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

    // Run post-processing (ITN + punctuation + speaker diarization + voiceprint matching)
    const currentSessionSegmentCount = segments.length - capturedSegmentCountAtStart;
    if (capturedJobId && audioPath && currentSessionSegmentCount > 0) {
      set({ processingStep: "diarizing" });
      try {
        await api.postProcessJob(capturedJobId, audioPath);
        const result = await tauriFetch(
          `http://127.0.0.1:18090/jobs/${capturedJobId}/result`,
          { method: "GET" }
        );
        if (result.status >= 200 && result.status < 300) {
          const data = JSON.parse(result.body);
          const postProcessedSegments: Segment[] = data.segments.map(
            (s: { start: number; end: number; text: string; speaker: string | null; confidence: number | null }) => ({
              id: crypto.randomUUID(),
              start: s.start,
              end: s.end,
              text: s.text,
              speaker: s.speaker || null,
              confidence: s.confidence || null,
            })
          );

          // Voiceprint matching: pass embeddings to Rust for library comparison
          const embeddings: (number[] | null)[] = data.embeddings || [];
          if (embeddings.length > 0) {
            try {
              const threshold = useSettingsStore.getState().general.diarizationThreshold;
              const matchResult = await invoke<VoiceprintMatchResult>(
                "voiceprint_match",
                { embeddings, threshold }
              );
              for (let i = 0; i < postProcessedSegments.length; i++) {
                if (matchResult.assignments[i]) {
                  postProcessedSegments[i].voiceprintId = matchResult.assignments[i];
                }
                if (matchResult.speaker_names[i]) {
                  postProcessedSegments[i].speaker = matchResult.speaker_names[i];
                }
              }
            } catch {
              // Voiceprint matching failure is non-fatal
            }
          }

          // Merge: keep pre-existing segments, replace only current session's portion
          const allSegments = useTranscriptionStore.getState().segments;
          const previousSegments = allSegments.slice(0, capturedSegmentCountAtStart);
          const mergedSegments = [...previousSegments, ...postProcessedSegments];
          useTranscriptionStore.getState().setSegments(mergedSegments);
          if (activeProjectId) {
            await useTranscriptionStore.getState().persistSegments(activeProjectId);
          }
        }
      } catch {
        // Diarization failure is non-fatal, continue with unlabeled segments
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
    const titleSegments = useTranscriptionStore.getState().segments;
    if (activeProjectId && titleSegments.length > 0 && isFirstRecording) {
      set({ processingStep: "titling" });
      const activeProject = useProjectStore.getState().projects.find(
        (p) => p.id === activeProjectId
      );
      if (activeProject && !activeProject.isFolder) {
        const transcriptText = titleSegments.map((s) => s.text).join(" ");
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
    if (capturedJobId) {
      api.cancelJob(capturedJobId).catch(() => {});
    }
  },

  reset: () => {
    clearElapsedTimer();
    cleanupSegmentListener();
    useTranscriptionStore.getState().stopAutoPersist();
    set({
      status: "idle",
      jobId: null,
      elapsed: 0,
      streamSegmentCount: 0,
      segmentCountAtStart: 0,
      processingStep: null,
    });
  },
}));
