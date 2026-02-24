import { invoke } from "@tauri-apps/api/core";

const ASR_BASE_URL = "http://127.0.0.1:18090";

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const resp = await fetch(url, init);
  if (!resp.ok) {
    const detail = await resp.text().catch(() => "Unknown error");
    throw new Error(`HTTP ${resp.status}: ${detail}`);
  }
  return resp.json();
}

export async function startAsrService(): Promise<string> {
  return invoke<string>("start_asr_service");
}

export async function stopAsrService(): Promise<string> {
  return invoke<string>("stop_asr_service");
}

export async function checkAsrHealth(): Promise<{
  status: string;
  engines: string[];
}> {
  return fetchJson(`${ASR_BASE_URL}/health`);
}

export interface CreateJobParams {
  mode?: "file" | "stream";
  engine?: string;
  model_size?: string;
  language?: string | null;
}

export interface JobResponse {
  id: string;
  mode: string;
  status: string;
  engine: string;
  model_size: string;
  language: string | null;
  progress: number;
  segment_count: number;
  error: string | null;
}

export async function createJob(
  params: CreateJobParams = {}
): Promise<JobResponse> {
  return fetchJson(`${ASR_BASE_URL}/jobs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
}

export async function getJob(jobId: string): Promise<JobResponse> {
  return fetchJson(`${ASR_BASE_URL}/jobs/${jobId}`);
}

export async function pauseJob(jobId: string): Promise<JobResponse> {
  return fetchJson(`${ASR_BASE_URL}/jobs/${jobId}/pause`, {
    method: "PUT",
  });
}

export async function resumeJob(jobId: string): Promise<JobResponse> {
  return fetchJson(`${ASR_BASE_URL}/jobs/${jobId}/resume`, {
    method: "PUT",
  });
}

export async function cancelJob(jobId: string): Promise<JobResponse> {
  return fetchJson(`${ASR_BASE_URL}/jobs/${jobId}/cancel`, {
    method: "PUT",
  });
}

export interface EngineInfo {
  name: string;
  supported_languages: string[];
  supports_streaming: boolean;
  supports_timestamps: boolean;
  supports_diarization: boolean;
  model_sizes: string[];
  is_loaded: boolean;
  current_model_size: string | null;
}

export async function listEngines(): Promise<EngineInfo[]> {
  return fetchJson(`${ASR_BASE_URL}/engines`);
}
