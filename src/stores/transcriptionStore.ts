import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import type { Segment, JobStatus, PipelineStep, Summary } from "../types";
import * as api from "../services/asrClient";

// Polling timer reference for cleanup
let pollTimeoutId: ReturnType<typeof setTimeout> | null = null;

function cancelPolling() {
  if (pollTimeoutId) {
    clearTimeout(pollTimeoutId);
    pollTimeoutId = null;
  }
}

interface TranscriptionStore {
  job: {
    id: string | null;
    mode: "file" | "stream";
    status: JobStatus;
    progress: number;
    pipelineStep: PipelineStep;
  };
  segments: Segment[];
  summary: Summary | null;
  audio: {
    source: "file" | "microphone" | null;
    filePath: string | null;
    objectUrl: string | null;
    duration: number;
    currentTime: number;
    isPlaying: boolean;
    playbackSpeed: number;
  };

  setAudioFile: (filePath: string, objectUrl: string) => void;
  startTranscription: (engine: string, modelSize: string, language: string | null) => Promise<void>;
  pollJobStatus: (jobId: string) => Promise<void>;
  setSegments: (segments: Segment[]) => void;
  setJobStatus: (status: JobStatus) => void;
  setProgress: (progress: number) => void;
  seekTo: (time: number) => void;
  setIsPlaying: (isPlaying: boolean) => void;
  setCurrentTime: (time: number) => void;
  setDuration: (duration: number) => void;
  setPlaybackSpeed: (speed: number) => void;
  updateSegmentText: (id: string, text: string) => void;
  updateSegmentSpeaker: (oldName: string, newName: string) => void;
  setSummary: (summary: Summary | null) => void;
  toggleActionItem: (index: number) => void;
  setPipelineStep: (step: PipelineStep) => void;
  loadProjectData: (projectId: string) => Promise<void>;
  persistSegments: (projectId: string) => Promise<void>;
  persistSummary: (projectId: string) => Promise<void>;
  reset: () => void;
}

const initialState = {
  job: {
    id: null as string | null,
    mode: "file" as const,
    status: "idle" as JobStatus,
    progress: 0,
    pipelineStep: null as PipelineStep,
  },
  segments: [] as Segment[],
  summary: null as Summary | null,
  audio: {
    source: null as "file" | "microphone" | null,
    filePath: null as string | null,
    objectUrl: null as string | null,
    duration: 0,
    currentTime: 0,
    isPlaying: false,
    playbackSpeed: 1,
  },
};

// Map segment to Rust format for persistence
function segmentToRust(s: Segment) {
  return {
    id: s.id,
    start: s.start,
    end: s.end,
    text: s.text,
    speaker: s.speaker,
    confidence: s.confidence,
  };
}

// Map summary to Rust format for persistence
function summaryToRust(s: Summary) {
  return {
    topic: s.topic,
    conclusions: s.conclusions,
    action_items: s.actionItems.map((item) => ({
      assignee: item.assignee,
      task: item.task,
      deadline: item.deadline,
      done: item.done,
    })),
    discussion: s.discussion,
    raw_markdown: s.rawMarkdown,
    edited_markdown: s.editedMarkdown,
  };
}

// Map summary from Rust format
function summaryFromRust(r: {
  topic: string;
  conclusions: string[];
  action_items: Array<{ assignee: string; task: string; deadline: string | null; done?: boolean }>;
  discussion: Array<{ topic: string; summary: string }>;
  raw_markdown: string;
  edited_markdown: string | null;
}): Summary {
  return {
    topic: r.topic,
    conclusions: r.conclusions,
    actionItems: r.action_items,
    discussion: r.discussion,
    rawMarkdown: r.raw_markdown,
    editedMarkdown: r.edited_markdown,
  };
}

export const useTranscriptionStore = create<TranscriptionStore>((set, get) => ({
  ...initialState,

  setAudioFile: (filePath, objectUrl) => {
    // Revoke previous blob URL to prevent memory leak
    const prev = get().audio.objectUrl;
    if (prev) {
      URL.revokeObjectURL(prev);
    }
    set({
      audio: { ...get().audio, source: "file", filePath, objectUrl },
    });
  },

  startTranscription: async (engine, modelSize, language) => {
    const { audio } = get();
    if (!audio.filePath) return;

    // Cancel any existing polling
    cancelPolling();

    const jobResp = await api.createJob({
      mode: "file",
      engine,
      model_size: modelSize,
      language,
    });

    set({
      job: { ...get().job, id: jobResp.id, status: "running", progress: 0 },
    });

    // Start transcription with file path
    await fetch(`http://127.0.0.1:18090/jobs/${jobResp.id}/start?audio_path=${encodeURIComponent(audio.filePath)}`, {
      method: "POST",
    });

    // Start polling
    get().pollJobStatus(jobResp.id);
  },

  pollJobStatus: async (jobId) => {
    cancelPolling();

    const poll = async () => {
      try {
        const jobResp = await api.getJob(jobId);
        set({
          job: {
            ...get().job,
            status: jobResp.status as JobStatus,
            progress: jobResp.progress,
          },
        });

        if (jobResp.status === "completed" || jobResp.status === "ready") {
          // Fetch results
          const resp = await fetch(`http://127.0.0.1:18090/jobs/${jobId}/result`);
          if (resp.ok) {
            const data = await resp.json();
            const segments: Segment[] = data.segments.map(
              (s: { start: number; end: number; text: string; speaker: string | null; confidence: number | null }, i: number) => ({
                id: `seg-${i}`,
                ...s,
              })
            );
            set({ segments, summary: data.summary || null });
          }
          pollTimeoutId = null;
          return;
        }

        if (jobResp.status === "cancelled" || jobResp.error) {
          pollTimeoutId = null;
          return;
        }

        // Continue polling
        pollTimeoutId = setTimeout(() => poll(), 1000);
      } catch {
        // Retry on network error
        pollTimeoutId = setTimeout(() => poll(), 2000);
      }
    };

    poll();
  },

  setSegments: (segments) => set({ segments }),
  setJobStatus: (status) => set({ job: { ...get().job, status } }),
  setProgress: (progress) => set({ job: { ...get().job, progress } }),
  seekTo: (time) => set({ audio: { ...get().audio, currentTime: time } }),
  setIsPlaying: (isPlaying) => set({ audio: { ...get().audio, isPlaying } }),
  setCurrentTime: (time) => set({ audio: { ...get().audio, currentTime: time } }),
  setDuration: (duration) => set({ audio: { ...get().audio, duration } }),
  setPlaybackSpeed: (speed) => set({ audio: { ...get().audio, playbackSpeed: speed } }),

  updateSegmentText: (id, text) => {
    set({
      segments: get().segments.map((s) =>
        s.id === id ? { ...s, text } : s
      ),
    });
  },

  updateSegmentSpeaker: (oldName, newName) => {
    set({
      segments: get().segments.map((s) =>
        s.speaker === oldName ? { ...s, speaker: newName } : s
      ),
    });
  },

  setSummary: (summary) => set({ summary }),

  toggleActionItem: (index) => {
    const { summary } = get();
    if (!summary) return;
    const items = summary.actionItems.map((item, i) =>
      i === index ? { ...item, done: !item.done } : item
    );
    set({ summary: { ...summary, actionItems: items } });
  },

  setPipelineStep: (step) => set({ job: { ...get().job, pipelineStep: step } }),

  loadProjectData: async (projectId: string) => {
    // Load segments from SQLite
    const rawSegments = await invoke<
      Array<{
        id: string;
        start: number;
        end: number;
        text: string;
        speaker: string | null;
        confidence: number | null;
      }>
    >("db_get_segments", { projectId });
    const segments: Segment[] = rawSegments.map((s) => ({
      id: s.id,
      start: s.start,
      end: s.end,
      text: s.text,
      speaker: s.speaker,
      confidence: s.confidence,
    }));

    // Load summary from SQLite
    const rawSummary = await invoke<{
      topic: string;
      conclusions: string[];
      action_items: Array<{ assignee: string; task: string; deadline: string | null; done?: boolean }>;
      discussion: Array<{ topic: string; summary: string }>;
      raw_markdown: string;
      edited_markdown: string | null;
    } | null>("db_get_summary", { projectId });

    const summary = rawSummary ? summaryFromRust(rawSummary) : null;

    set({ segments, summary });
  },

  persistSegments: async (projectId: string) => {
    const { segments } = get();
    await invoke("db_save_segments", {
      projectId,
      segments: segments.map(segmentToRust),
    });
  },

  persistSummary: async (projectId: string) => {
    const { summary } = get();
    if (!summary) return;
    await invoke("db_save_summary", {
      projectId,
      summary: summaryToRust(summary),
    });
  },

  reset: () => {
    cancelPolling();
    const prev = get().audio.objectUrl;
    if (prev) {
      URL.revokeObjectURL(prev);
    }
    set(initialState);
  },
}));
