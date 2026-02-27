import { invoke } from "@tauri-apps/api/core";
import { tauriFetch } from "./httpProxy";

const ASR_BASE_URL = "http://127.0.0.1:18090";

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const resp = await tauriFetch(url, {
    method: init?.method ?? "GET",
    headers: init?.headers as Record<string, string> | undefined,
    body: init?.body as string | undefined,
  });
  if (resp.status < 200 || resp.status >= 300) {
    throw new Error(`HTTP ${resp.status}: ${resp.body}`);
  }
  return JSON.parse(resp.body);
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
  downloaded_models: string[];
}

export async function listEngines(): Promise<EngineInfo[]> {
  return fetchJson(`${ASR_BASE_URL}/engines`);
}

export type LoadPhase = "idle" | "preparing" | "loading" | "ready" | "error";

export interface LoadResponse {
  status: "loading" | "already_loaded";
  engine_name: string;
  model_size: string;
}

export interface LoadingStatus {
  engine_name: string;
  model_size: string | null;
  phase: LoadPhase;
  elapsed_seconds: number;
  error: string | null;
}

export async function loadEngineModel(
  engineName: string,
  modelSize: string
): Promise<LoadResponse> {
  return fetchJson(
    `${ASR_BASE_URL}/engines/${engineName}/load?model_size=${encodeURIComponent(modelSize)}`,
    { method: "POST" }
  );
}

export async function getLoadStatus(
  engineName: string
): Promise<LoadingStatus> {
  return fetchJson(
    `${ASR_BASE_URL}/engines/${engineName}/load-status`
  );
}

export async function unloadEngineModel(
  engineName: string
): Promise<EngineInfo> {
  return fetchJson(`${ASR_BASE_URL}/engines/${engineName}/unload`, {
    method: "POST",
  });
}

export async function configureEngine(
  engineName: string,
  credentials: Record<string, string>
): Promise<{ status: string }> {
  return fetchJson(`${ASR_BASE_URL}/engines/${engineName}/configure`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ credentials }),
  });
}

// --- Download API ---

export type DownloadPhase = "idle" | "downloading" | "completed" | "error";

export interface DownloadResponse {
  status: "downloading" | "already_downloaded";
  engine_name: string;
  model_size: string;
}

export interface DownloadStatus {
  engine_name: string;
  model_size: string | null;
  phase: DownloadPhase;
  elapsed_seconds: number;
  error: string | null;
}

export async function downloadEngineModel(
  engineName: string,
  modelSize: string
): Promise<DownloadResponse> {
  return fetchJson(
    `${ASR_BASE_URL}/engines/${engineName}/download?model_size=${encodeURIComponent(modelSize)}`,
    { method: "POST" }
  );
}

export async function getDownloadStatus(
  engineName: string
): Promise<DownloadStatus> {
  return fetchJson(
    `${ASR_BASE_URL}/engines/${engineName}/download-status`
  );
}

// --- Model Path API ---

export interface ModelPathResponse {
  engine_name: string;
  model_size: string;
  path: string | null;
}

export async function getModelPath(
  engineName: string,
  modelSize: string
): Promise<ModelPathResponse> {
  return fetchJson(
    `${ASR_BASE_URL}/engines/${engineName}/model-path?model_size=${encodeURIComponent(modelSize)}`
  );
}
