import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import type { Segment, JobStatus, PipelineStep, Summary, VoiceprintMatchResult } from "../types";
import * as api from "../services/asrClient";
import { loadAudioUrl } from "../services/audioLoader";
import { tauriFetch } from "../services/httpProxy";
import { indexProject } from "../services/knowledgeClient";
import { generateMeetingTitle, generateMeetingSummary } from "../services/llmClient";

// Polling timer reference and abort flag for cleanup
let pollTimeoutId: ReturnType<typeof setTimeout> | null = null;
let pollAborted = false;

// Auto-persist timer for crash recovery during recording
let autoPersistTimerId: ReturnType<typeof setInterval> | null = null;

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
  assignSegmentVoiceprint: (segmentId: string, voiceprintId: string, name: string) => void;
  setSummary: (summary: Summary | null) => void;
  toggleActionItem: (index: number) => void;
  setPipelineStep: (step: PipelineStep) => void;
  loadProjectData: (projectId: string) => Promise<void>;
  addStreamSegment: (segment: Segment) => void;
  startAutoPersist: (projectId: string) => void;
  stopAutoPersist: () => void;
  persistSegments: (projectId: string, skipIndex?: boolean) => Promise<void>;
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
    voiceprint_id: s.voiceprintId ?? null,
  };
}

// Map summary to Rust format for persistence
function summaryToRust(s: Summary) {
  return {
    topic: s.topic,
    conclusions: s.conclusions,
    decisions: s.decisions.map((d) => ({
      decision: d.decision,
      made_by: d.madeBy,
      reasoning: d.reasoning,
    })),
    action_items: s.actionItems.map((item) => ({
      assignee: item.assignee,
      task: item.task,
      deadline: item.deadline,
      priority: item.priority,
      status: item.status,
      done: item.done,
    })),
    discussion: s.discussion.map((d) => ({
      topic: d.topic,
      summary: d.summary,
      participants: d.participants,
      key_points: d.keyPoints,
    })),
    technical_details: s.technicalDetails.map((td) => ({
      category: td.category,
      details: td.details,
    })),
    next_steps: s.nextSteps,
    key_data: s.keyData,
    participants: s.participants,
    raw_markdown: s.rawMarkdown,
    edited_markdown: s.editedMarkdown,
  };
}

// Map summary from Rust format
function summaryFromRust(r: {
  topic: string;
  conclusions: string[];
  decisions?: Array<{ decision: string; made_by: string; reasoning: string }>;
  action_items: Array<{ assignee: string; task: string; deadline: string | null; priority?: string; status?: string; done?: boolean }>;
  discussion: Array<{ topic: string; summary: string; participants?: string[]; key_points?: string[] }>;
  technical_details?: Array<{ category: string; details: string }>;
  next_steps?: string[];
  key_data?: string[];
  participants?: string[];
  raw_markdown: string;
  edited_markdown: string | null;
}): Summary {
  return {
    topic: r.topic,
    conclusions: r.conclusions,
    decisions: (r.decisions || []).map((d) => ({
      decision: d.decision,
      madeBy: d.made_by,
      reasoning: d.reasoning,
    })),
    actionItems: r.action_items.map((item) => ({
      assignee: item.assignee,
      task: item.task,
      deadline: item.deadline,
      priority: item.priority || "medium",
      status: item.status || "not_started",
      done: item.done,
    })),
    discussion: r.discussion.map((d) => ({
      topic: d.topic,
      summary: d.summary,
      participants: d.participants || [],
      keyPoints: d.key_points || [],
    })),
    technicalDetails: (r.technical_details || []).map((td) => ({
      category: td.category,
      details: td.details,
    })),
    nextSteps: r.next_steps || [],
    keyData: r.key_data || [],
    participants: r.participants || [],
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

    try {
      // Ensure ASR model is loaded before starting transcription
      set({ job: { ...get().job, status: "running" as JobStatus, pipelineStep: "loading_model" as PipelineStep } });
      const loadResp = await api.loadEngineModel(engine, modelSize);
      if (loadResp.status === "loading") {
        const MAX_WAIT_MS = 300_000;
        const POLL_MS = 1_000;
        const start = Date.now();
        let loaded = false;
        while (Date.now() - start < MAX_WAIT_MS) {
          await new Promise((r) => setTimeout(r, POLL_MS));
          const status = await api.getLoadStatus(engine);
          if (status.phase === "ready") { loaded = true; break; }
          if (status.phase === "error") {
            throw new Error(status.error || "Model load failed");
          }
        }
        if (!loaded) {
          throw new Error("模型加载超时，请检查模型是否已下载");
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
      const startResp = await tauriFetch(`http://127.0.0.1:18090/jobs/${jobResp.id}/start?audio_path=${encodeURIComponent(audio.filePath)}`, {
        method: "POST",
      });
      if (startResp.status < 200 || startResp.status >= 300) {
        let detail = "";
        try { detail = JSON.parse(startResp.body).detail; } catch { detail = startResp.body; }
        throw new Error(detail || `启动转录失败 (HTTP ${startResp.status})`);
      }

      // Start polling — capture project ID so results persist to the correct project
      // even if the user switches meetings during transcription
      const { useProjectStore } = await import("./projectStore");
      const targetProjectId = useProjectStore.getState().activeProjectId;
      get().pollJobStatus(jobResp.id, targetProjectId || undefined);
    } catch (err) {
      // Reset job status so UI doesn't stay stuck in "running" state
      set({ job: { ...get().job, status: "idle" as JobStatus, progress: 0, pipelineStep: null as PipelineStep } });
      throw err;
    }
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

          if (resp.status < 200 || resp.status >= 300) {
            // Result fetch failed — show error and stop polling
            toast.error(`转录结果获取失败 (HTTP ${resp.status})`);
            set({ job: { ...get().job, status: "idle" as JobStatus, progress: 0, pipelineStep: null as PipelineStep } });
            pollTimeoutId = null;
            return;
          }

          let data: { segments?: unknown[] };
          try {
            data = JSON.parse(resp.body);
          } catch {
            toast.error("转录结果解析失败");
            set({ job: { ...get().job, status: "idle" as JobStatus, progress: 0, pipelineStep: null as PipelineStep } });
            pollTimeoutId = null;
            return;
          }

          const existingSegments = get().segments;
          const hadExistingSegments = existingSegments.length > 0;
          type RawSeg = { start: number; end: number; text: string; speaker: string | null; confidence: number | null };
          const rawSegments = (Array.isArray(data?.segments) ? data.segments : []) as RawSeg[];
          const segments: Segment[] = rawSegments.map((s) => ({
            id: crypto.randomUUID(),
            ...s,
          }));

          // Voiceprint matching: pass embeddings to Rust for library comparison
          const embeddings: (number[] | null)[] = (data as { embeddings?: (number[] | null)[] }).embeddings || [];
          if (embeddings.length > 0) {
            try {
              const { useSettingsStore } = await import("./settingsStore");
              const threshold = useSettingsStore.getState().general.diarizationThreshold;
              const matchResult = await invoke<VoiceprintMatchResult>(
                "voiceprint_match",
                { embeddings, threshold }
              );
              for (let i = 0; i < segments.length; i++) {
                if (matchResult.assignments[i]) {
                  segments[i] = { ...segments[i], voiceprintId: matchResult.assignments[i]! };
                }
                if (matchResult.speaker_names[i]) {
                  segments[i] = { ...segments[i], speaker: matchResult.speaker_names[i]! };
                }
              }
            } catch {
              // Voiceprint matching failure is non-fatal
            }
          }

          // If regeneration produced empty results but we had segments, keep old ones
          if (segments.length === 0 && hadExistingSegments) {
            toast.warning("重新转录未检测到语音，已保留原有转录内容");
            set({ job: { ...get().job, status: "idle" as JobStatus, progress: 0, pipelineStep: null as PipelineStep } });
            pollTimeoutId = null;
            return;
          }

          // Warn if transcription produced no results
          if (segments.length === 0) {
            toast.warning("转录完成，但未检测到语音内容");
          }

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

          // Reset job status to idle unconditionally — the job is global state
          // and a stale non-idle status blocks future transcription operations
          set({ job: { ...get().job, status: "idle" as JobStatus, pipelineStep: null as PipelineStep } });
          pollTimeoutId = null;
          return;
        }

        if (jobResp.status === "idle") {
          // Job never started — /start may have failed silently
          pollTimeoutId = null;
          toast.error("转录任务未启动，请检查 ASR 服务日志");
          set({ job: { ...get().job, status: "idle" as JobStatus, progress: 0, pipelineStep: null as PipelineStep } });
          return;
        }

        if (jobResp.status === "cancelled" || jobResp.error) {
          pollTimeoutId = null;
          if (jobResp.error) {
            toast.error(jobResp.error);
          }
          // Reset job status so UI shows proper idle state
          set({ job: { ...get().job, status: "idle" as JobStatus, progress: 0, pipelineStep: null as PipelineStep } });
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
    const reindexed = newSegments.map((s) => ({
      ...s,
      id: crypto.randomUUID(),
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

  assignSegmentVoiceprint: (segmentId, voiceprintId, name) => {
    set({
      segments: get().segments.map((s) =>
        s.id === segmentId ? { ...s, voiceprintId, speaker: name } : s
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
        voiceprint_id: string | null;
      }>
    >("db_get_segments", { projectId });
    const segments: Segment[] = rawSegments.map((s) => ({
      id: s.id,
      start: s.start,
      end: s.end,
      text: s.text,
      speaker: s.speaker,
      confidence: s.confidence,
      voiceprintId: s.voiceprint_id,
    }));

    // Load summary from SQLite
    const rawSummary = await invoke<{
      topic: string;
      conclusions: string[];
      decisions?: Array<{ decision: string; made_by: string; reasoning: string }>;
      action_items: Array<{ assignee: string; task: string; deadline: string | null; priority?: string; status?: string; done?: boolean }>;
      discussion: Array<{ topic: string; summary: string; participants?: string[]; key_points?: string[] }>;
      technical_details?: Array<{ category: string; details: string }>;
      next_steps?: string[];
      key_data?: string[];
      participants?: string[];
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

  addStreamSegment: (segment) => {
    set({ segments: [...get().segments, segment] });
  },

  startAutoPersist: (projectId) => {
    if (autoPersistTimerId) clearInterval(autoPersistTimerId);
    autoPersistTimerId = setInterval(async () => {
      try {
        // Skip indexing during auto-persist to avoid repeated API calls
        await get().persistSegments(projectId, true);
      } catch {
        // Ignore persist errors during recording — will retry next interval
      }
    }, 30_000);
  },

  stopAutoPersist: () => {
    if (autoPersistTimerId) {
      clearInterval(autoPersistTimerId);
      autoPersistTimerId = null;
    }
  },

  persistSegments: async (projectId: string, skipIndex = false) => {
    const { segments } = get();
    await invoke("db_save_segments", {
      projectId,
      segments: segments.map(segmentToRust),
    });
    // Only trigger indexing on explicit saves (e.g. after post-processing),
    // NOT during auto-persist intervals to avoid repeated API calls.
    if (!skipIndex) {
      indexProject(projectId).catch(() => {});
    }
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
