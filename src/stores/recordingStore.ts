import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import * as api from "../services/asrClient";
import { useTranscriptionStore } from "./transcriptionStore";
import { useProjectStore } from "./projectStore";
import { generateMeetingTitle } from "../services/llmClient";
import type { Segment } from "../types";

type RecordingStatus = "idle" | "recording" | "paused";

interface RecordingStore {
  status: RecordingStatus;
  jobId: string | null;
  elapsed: number;
  segments: Segment[];

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

export const useRecordingStore = create<RecordingStore>((set, get) => ({
  status: "idle",
  jobId: null,
  elapsed: 0,
  segments: [],

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
      await invoke<string>("start_recording", { jobId: job.id });
    } catch (err) {
      // If Tauri invoke fails (e.g., in dev browser), recording UI still works
      console.warn("Audio capture unavailable:", err);
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

    const { segments, jobId } = get();
    set({ status: "idle", jobId: null, elapsed: 0, segments: [] });

    // Sync segments to transcription store before cleanup
    if (segments.length > 0) {
      const { setSegments, setJobStatus, persistSegments } = useTranscriptionStore.getState();
      setSegments(segments);
      setJobStatus("completed");

      // Persist segments to SQLite
      const pid = useProjectStore.getState().activeProjectId;
      if (pid) {
        persistSegments(pid).catch(() => {});
      }
    }

    // Stop audio capture in Rust and get saved WAV path
    let audioPath: string | null = null;
    try {
      const result = await invoke<string>("stop_recording");
      if (result && result.length > 0) {
        audioPath = result;
      }
    } catch {
      // Ignore if not in Tauri
    }

    // Update project with audio path
    const activeProjectId = useProjectStore.getState().activeProjectId;
    if (activeProjectId && audioPath) {
      await useProjectStore.getState().updateProject(activeProjectId, { audioPath });
    }

    // Auto-generate AI title for the active meeting
    if (activeProjectId && segments.length > 0) {
      const activeProject = useProjectStore.getState().projects.find(
        (p) => p.id === activeProjectId
      );
      if (activeProject && !activeProject.isFolder) {
        const transcriptText = segments.map((s) => s.text).join(" ");
        generateMeetingTitle(activeProject.createdAt, transcriptText)
          .then(async (title) => {
            await useProjectStore.getState().updateProject(activeProjectId, { title });
          })
          .catch(() => {
            // Silently fail - user can manually generate later
          });
      }
    }

    // Cancel the ASR job
    if (jobId) {
      try {
        await api.cancelJob(jobId);
      } catch {
        // Ignore API errors
      }
    }
  },

  addSegment: (segment) => {
    set({ segments: [...get().segments, segment] });
  },

  reset: () => {
    clearElapsedTimer();
    closeWebSocket();
    set({ status: "idle", jobId: null, elapsed: 0, segments: [] });
  },
}));
