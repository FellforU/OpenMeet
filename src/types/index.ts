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
