export interface Project {
  id: string;
  title: string;
  parentId: string | null;
  isFolder: boolean;
  sortOrder: number;
  audioPath: string | null;
  durationMs: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface Segment {
  id: string;
  start: number;
  end: number;
  text: string;
  speaker: string | null;
  confidence: number | null;
  voiceprintId?: string | null;
}

export interface Summary {
  topic: string;
  conclusions: string[];
  actionItems: Array<{ assignee: string; task: string; deadline: string | null; done?: boolean }>;
  discussion: Array<{ topic: string; summary: string }>;
  rawMarkdown: string;
  editedMarkdown: string | null;
}

export type JobStatus =
  | "idle"
  | "running"
  | "paused"
  | "cancelled"
  | "completed"
  | "post_processing"
  | "ready";

export type PipelineStep =
  | "loading_model"
  | "transcribing"
  | "itn"
  | "punctuation"
  | "diarizing"
  | "summarizing"
  | null;

export interface VoiceprintInfo {
  id: string;
  name: string;
  nickname: string;
  email: string;
  department: string;
  title: string;
  note: string;
  avatarPath: string | null;
  sampleCount: number;
  modelVersion: string;
  createdAt: string;
  updatedAt: string;
  lastSeenAt: string | null;
}

export interface VoiceprintMetadata {
  name?: string;
  nickname?: string;
  email?: string;
  department?: string;
  title?: string;
  note?: string;
  avatarPath?: string;
}

export interface VoiceprintMatchResult {
  assignments: (string | null)[];
  speaker_names: (string | null)[];
  new_voiceprint_ids: string[];
}
