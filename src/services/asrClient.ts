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

export async function startAsrService(cacheDir?: string): Promise<string> {
  return invoke<string>("start_asr_service", {
    cacheDir: cacheDir || null,
  });
}

export async function stopAsrService(): Promise<string> {
  return invoke<string>("stop_asr_service");
}

export async function restartAsrService(cacheDir?: string): Promise<string> {
  await stopAsrService();
  // Small delay to allow process to fully terminate
  await new Promise((resolve) => setTimeout(resolve, 500));
  return startAsrService(cacheDir);
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
  pipeline_step: string | null;
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

export async function postProcessJob(
  jobId: string,
  audioPath?: string,
  numSpeakers?: number,
): Promise<JobResponse> {
  const searchParams = new URLSearchParams();
  if (audioPath) searchParams.set("audio_path", audioPath);
  if (numSpeakers !== undefined) searchParams.set("num_speakers", String(numSpeakers));
  const qs = searchParams.toString();
  return fetchJson(`${ASR_BASE_URL}/jobs/${jobId}/post-process${qs ? `?${qs}` : ""}`, {
    method: "POST",
  });
}

export interface ReprocessRequest {
  segments: Array<{
    start: number;
    end: number;
    text: string;
    speaker: string | null;
    confidence: number | null;
  }>;
  audio_path?: string;
  engine?: string;
  language?: string;
  num_speakers?: number;
}

export interface ReprocessStartResponse {
  job_id: string;
}

export interface JobResultResponse {
  id: string;
  status: string;
  segments: Array<{
    start: number;
    end: number;
    text: string;
    speaker: string | null;
    confidence: number | null;
  }>;
  summary?: Record<string, unknown> | null;
  embeddings?: Array<number[] | null> | null;
}

/** 启动后台重新后处理，返回 job_id；进度经 getJob 轮询，结果经 getJobResult 获取 */
export async function reprocessSegments(
  req: ReprocessRequest
): Promise<ReprocessStartResponse> {
  return fetchJson(`${ASR_BASE_URL}/jobs/reprocess`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
}

export async function getJobResult(jobId: string): Promise<JobResultResponse> {
  return fetchJson(`${ASR_BASE_URL}/jobs/${jobId}/result`);
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

export async function cancelLoad(
  engineName: string
): Promise<LoadingStatus> {
  return fetchJson(
    `${ASR_BASE_URL}/engines/${engineName}/cancel-load`,
    { method: "POST" }
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
  downloaded_bytes: number;
  total_bytes: number;
  error: string | null;
  model_name: string | null;
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

export async function cancelDownload(
  engineName: string
): Promise<DownloadStatus> {
  return fetchJson(
    `${ASR_BASE_URL}/engines/${engineName}/cancel-download`,
    { method: "POST" }
  );
}

// --- Custom Model API ---

export interface CustomModelPayload {
  id: string;
  name: string;
  platform: string;
  model_id: string;
  mirror_url?: string | null;
  vram_gb: number;
}

export interface ValidateCustomModelParams {
  platform: string;
  model_id: string;
  mirror_url?: string | null;
}

export interface ValidateCustomModelResponse {
  valid: boolean;
  error?: string | null;
  model_name?: string | null;
  tags?: string[] | null;
}

export async function pushCustomModels(
  models: CustomModelPayload[]
): Promise<{ status: string; count: number }> {
  return fetchJson(`${ASR_BASE_URL}/custom/models`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ models }),
  });
}

export async function validateCustomModel(
  params: ValidateCustomModelParams
): Promise<ValidateCustomModelResponse> {
  return fetchJson(`${ASR_BASE_URL}/custom/validate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
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

// --- Diarization (pyannote) Model API ---

export interface PyannoteStatus {
  downloaded: boolean;
  phase: "idle" | "downloading" | "completed" | "error";
  elapsed_seconds: number;
  downloaded_bytes: number;
  total_bytes: number;
  error: string | null;
  path: string | null;
}

export async function getPyannoteStatus(): Promise<PyannoteStatus> {
  return fetchJson(`${ASR_BASE_URL}/diarization/pyannote/status`);
}

export async function downloadPyannote(): Promise<{ status: string }> {
  return fetchJson(`${ASR_BASE_URL}/diarization/pyannote/download`, {
    method: "POST",
  });
}

export async function cancelPyannoteDownload(): Promise<{ status: string }> {
  return fetchJson(`${ASR_BASE_URL}/diarization/pyannote/cancel-download`, {
    method: "POST",
  });
}

// --- Local Embedding Model API ---

export interface EmbeddingModelInfo {
  key: string;
  repo_id: string;
  name: string;
  params: string;
  dimension: number;
  size_bytes: number;
  vram_gb: number;
  description_zh: string;
  description_en: string;
  languages: string[];
  downloaded: boolean;
  path: string | null;
}

export type EmbeddingDownloadPhase = "idle" | "downloading" | "completed" | "error";

export interface EmbeddingDownloadStatus {
  key: string;
  phase: EmbeddingDownloadPhase;
  elapsed_seconds: number;
  downloaded_bytes: number;
  total_bytes: number;
  error: string | null;
}

export async function listEmbeddingModels(): Promise<EmbeddingModelInfo[]> {
  return fetchJson(`${ASR_BASE_URL}/embedding/models`);
}

export async function downloadEmbeddingModel(
  key: string
): Promise<{ status: string }> {
  return fetchJson(`${ASR_BASE_URL}/embedding/models/${key}/download`, {
    method: "POST",
  });
}

export async function getEmbeddingDownloadStatus(
  key: string
): Promise<EmbeddingDownloadStatus> {
  return fetchJson(`${ASR_BASE_URL}/embedding/models/${key}/download-status`);
}

export async function cancelEmbeddingDownload(
  key: string
): Promise<{ status: string }> {
  return fetchJson(`${ASR_BASE_URL}/embedding/models/${key}/cancel-download`, {
    method: "POST",
  });
}
