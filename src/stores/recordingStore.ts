import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import * as api from "../services/asrClient";
import { useTranscriptionStore } from "./transcriptionStore";
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
    set({ status: "idle" });

    // Sync segments to transcription store before cleanup
    if (segments.length > 0) {
      const { setSegments, setJobStatus } = useTranscriptionStore.getState();
      setSegments(segments);
      setJobStatus("completed");
    }

    try {
      await invoke<string>("stop_recording");
    } catch {
      // Ignore if not in Tauri
    }

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
