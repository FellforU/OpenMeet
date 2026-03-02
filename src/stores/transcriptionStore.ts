import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import type { Segment, JobStatus, PipelineStep, Summary } from "../types";
import * as api from "../services/asrClient";
import { loadAudioUrl } from "../services/audioLoader";
import { tauriFetch } from "../services/httpProxy";
import { indexProject } from "../services/knowledgeClient";
import { generateMeetingTitle, generateMeetingSummary } from "../services/llmClient";

// Polling timer reference and abort flag for cleanup
let pollTimeoutId: ReturnType<typeof setTimeout> | null = null;
let pollAborted = false;

function cancelPolling() {
  pollAborted = true;
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
  highlightSegmentTime: number | null;

  setAudioFile: (filePath: string, objectUrl: string) => void;
  startTranscription: (engine: string, modelSize: string, language: string | null) => Promise<void>;
  pollJobStatus: (jobId: string, projectId?: string) => Promise<void>;
  setSegments: (segments: Segment[]) => void;
  appendSegments: (newSegments: Segment[]) => void;
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
  cancelTranscription: () => void;
  persistSummary: (projectId: string) => Promise<void>;
  clearHighlight: () => void;
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
  highlightSegmentTime: null as number | null,
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

    // Ensure ASR model is loaded before starting transcription
    set({ job: { ...get().job, status: "running" as JobStatus, pipelineStep: "loading_model" as PipelineStep } });
    const loadResp = await api.loadEngineModel(engine, modelSize);
    if (loadResp.status === "loading") {
      const MAX_WAIT_MS = 300_000;
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
    await tauriFetch(`http://127.0.0.1:18090/jobs/${jobResp.id}/start?audio_path=${encodeURIComponent(audio.filePath)}`, {
      method: "POST",
    });

    // Start polling — capture project ID so results persist to the correct project
    // even if the user switches meetings during transcription
    const { useProjectStore } = await import("./projectStore");
    const targetProjectId = useProjectStore.getState().activeProjectId;
    get().pollJobStatus(jobResp.id, targetProjectId || undefined);
  },

  pollJobStatus: async (jobId, projectId) => {
    cancelPolling();
    pollAborted = false;

    // Capture project ID at polling start time so results persist to the
    // correct project even if the user switches meetings during transcription
    const targetProjectId = projectId || null;

    const poll = async () => {
      if (pollAborted) return;

      try {
        const jobResp = await api.getJob(jobId);
        if (pollAborted) return;

        set({
          job: {
            ...get().job,
            status: jobResp.status as JobStatus,
            progress: jobResp.progress,
          },
        });

        if (jobResp.status === "completed" || jobResp.status === "ready") {
          // Fetch results
          const resp = await tauriFetch(`http://127.0.0.1:18090/jobs/${jobId}/result`, { method: "GET" });
          if (pollAborted) return;

          if (resp.status >= 200 && resp.status < 300) {
            const data = JSON.parse(resp.body);
            const hadExistingSegments = get().segments.length > 0;
            const segments: Segment[] = data.segments.map(
              (s: { start: number; end: number; text: string; speaker: string | null; confidence: number | null }, i: number) => ({
                id: `seg-${i}`,
                ...s,
              })
            );

            // Persist segments to SQLite using the captured project ID
            if (targetProjectId) {
              // Save to DB first (even if user switched meetings)
              await invoke("db_save_segments", {
                projectId: targetProjectId,
                segments: segments.map(segmentToRust),
              });
              indexProject(targetProjectId).catch(() => {});
            }

            // Only update UI state if user is still on the same meeting
            const { useProjectStore } = await import("./projectStore");
            const currentProjectId = useProjectStore.getState().activeProjectId;
            const isStillOnSameProject = currentProjectId === targetProjectId;

            if (isStillOnSameProject) {
              set({ segments });
            }

            // Auto-generate summary using frontend LLM client
            const { useSettingsStore } = await import("./settingsStore");
            const autoSummary = useSettingsStore.getState().general.autoSummary;
            if (autoSummary && targetProjectId && segments.length > 0) {
              try {
                if (isStillOnSameProject) {
                  set({ job: { ...get().job, pipelineStep: "summarizing" } });
                }

                // Generate title for first-time transcription of non-folder meetings
                if (!hadExistingSegments) {
                  const activeProject = useProjectStore.getState().projects.find(
                    (p) => p.id === targetProjectId
                  );
                  if (activeProject && !activeProject.isFolder) {
                    const transcriptText = segments.map((s) => s.text).join(" ");
                    try {
                      const title = await generateMeetingTitle(activeProject.createdAt, transcriptText);
                      await useProjectStore.getState().updateProject(targetProjectId, { title });
                    } catch {
                      if (isStillOnSameProject) toast.warning("标题生成失败，请手动设置");
                    }
                  }
                }

                // Generate summary
                const transcriptText = segments
                  .map((s) => (s.speaker ? `[${s.speaker}] ${s.text}` : s.text))
                  .join("\n");
                const summary = await generateMeetingSummary(transcriptText);
                if (isStillOnSameProject) {
                  set({ summary });
                }
                await get().persistSummary(targetProjectId);
              } catch {
                if (isStillOnSameProject) toast.warning("摘要生成失败，请检查 LLM 配置");
              } finally {
                if (isStillOnSameProject) {
                  set({ job: { ...get().job, pipelineStep: null } });
                }
              }
            }
          }
          pollTimeoutId = null;
          return;
        }

        if (jobResp.status === "cancelled" || jobResp.error) {
          pollTimeoutId = null;
          if (jobResp.error) {
            const { toast } = await import("sonner");
            toast.error(jobResp.error);
          }
          return;
        }

        // Continue polling
        if (!pollAborted) {
          pollTimeoutId = setTimeout(() => poll(), 1000);
        }
      } catch {
        // Retry on network error
        if (!pollAborted) {
          pollTimeoutId = setTimeout(() => poll(), 2000);
        }
      }
    };

    poll();
  },

  setSegments: (segments) => set({ segments }),
  appendSegments: (newSegments) => {
    const existing = get().segments;
    // Re-index IDs to avoid collision
    const offset = existing.length;
    const reindexed = newSegments.map((s, i) => ({
      ...s,
      id: `seg-${offset + i}`,
    }));
    set({ segments: [...existing, ...reindexed] });
  },
  setJobStatus: (status) => set({ job: { ...get().job, status } }),
  setProgress: (progress) => set({ job: { ...get().job, progress } }),
  seekTo: (time) => set({ audio: { ...get().audio, currentTime: time }, highlightSegmentTime: time }),
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

  cancelTranscription: () => {
    cancelPolling();
    const jobId = get().job.id;
    if (jobId) {
      api.cancelJob(jobId).catch(() => {});
    }
    set({ job: { ...get().job, status: "cancelled", progress: 0 } });
  },

  setPipelineStep: (step) => set({ job: { ...get().job, pipelineStep: step } }),

  loadProjectData: async (projectId: string) => {
    // Cancel any active polling from previous meeting
    cancelPolling();

    // Revoke previous audio blob URL
    const prevUrl = get().audio.objectUrl;
    if (prevUrl) {
      URL.revokeObjectURL(prevUrl);
    }

    // Reset all transient state before loading new meeting data
    // Preserve playbackSpeed as a user preference
    const savedSpeed = get().audio.playbackSpeed;
    set({
      job: { id: null, mode: "file", status: "idle" as JobStatus, progress: 0, pipelineStep: null as PipelineStep },
      segments: [],
      summary: null,
      audio: { ...initialState.audio, playbackSpeed: savedSpeed },
    });

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

    // Load audio file for playback if project has an audio path
    const { useProjectStore } = await import("./projectStore");
    const project = useProjectStore.getState().projects.find(
      (p) => p.id === projectId
    );
    if (project?.audioPath) {
      const objectUrl = await loadAudioUrl(project.audioPath);
      if (objectUrl) {
        get().setAudioFile(project.audioPath, objectUrl);
      }
    }
  },

  persistSegments: async (projectId: string) => {
    const { segments } = get();
    await invoke("db_save_segments", {
      projectId,
      segments: segments.map(segmentToRust),
    });
    // Trigger knowledge indexing in background
    indexProject(projectId).catch(() => {});
  },

  persistSummary: async (projectId: string) => {
    const { summary } = get();
    if (!summary) return;
    await invoke("db_save_summary", {
      projectId,
      summary: summaryToRust(summary),
    });
  },

  clearHighlight: () => set({ highlightSegmentTime: null }),

  reset: () => {
    cancelPolling();
    const prev = get().audio.objectUrl;
    if (prev) {
      URL.revokeObjectURL(prev);
    }
    set(initialState);
  },
}));
