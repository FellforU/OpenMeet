import { invoke } from "@tauri-apps/api/core";

const ASR_BASE_URL = "http://127.0.0.1:18090";

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
  const resp = await fetch(`${ASR_BASE_URL}/health`);
  return resp.json();
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
  const resp = await fetch(`${ASR_BASE_URL}/jobs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  return resp.json();
}

export async function getJob(jobId: string): Promise<JobResponse> {
  const resp = await fetch(`${ASR_BASE_URL}/jobs/${jobId}`);
  return resp.json();
}

export async function pauseJob(jobId: string): Promise<JobResponse> {
  const resp = await fetch(`${ASR_BASE_URL}/jobs/${jobId}/pause`, {
    method: "PUT",
  });
  return resp.json();
}

export async function resumeJob(jobId: string): Promise<JobResponse> {
  const resp = await fetch(`${ASR_BASE_URL}/jobs/${jobId}/resume`, {
    method: "PUT",
  });
  return resp.json();
}

export async function cancelJob(jobId: string): Promise<JobResponse> {
  const resp = await fetch(`${ASR_BASE_URL}/jobs/${jobId}/cancel`, {
    method: "PUT",
  });
  return resp.json();
}
