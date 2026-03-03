import { create } from "zustand";
import type { EngineInfo } from "../services/asrClient";
import * as api from "../services/asrClient";
import { useSettingsStore } from "./settingsStore";

interface ModelLoadingState {
  phase: api.LoadPhase;
  modelSize: string;
  elapsedSeconds: number;
  error: string | null;
}

interface ModelDownloadState {
  phase: api.DownloadPhase;
  modelSize: string;
  elapsedSeconds: number;
  downloadedBytes: number;
  totalBytes: number;
  error: string | null;
  modelName: string | null;
}

interface EngineStore {
  engines: EngineInfo[];
  selectedEngine: string;
  selectedModelSize: string;
  selectedLanguage: string;
  loading: boolean;
  loadingStates: Record<string, ModelLoadingState>;
  downloadStates: Record<string, ModelDownloadState>;

  fetchEngines: () => Promise<void>;
  setSelectedEngine: (engine: string) => void;
  setSelectedModelSize: (size: string) => void;
  setSelectedLanguage: (lang: string) => void;
  startModelLoad: (engineName: string, modelSize: string) => Promise<void>;
  pollLoadStatus: (engineName: string) => void;
  stopPolling: (engineName: string) => void;
  clearLoadingState: (engineName: string) => void;
  cancelModelLoad: (engineName: string) => Promise<void>;
  startModelDownload: (engineName: string, modelSize: string) => Promise<void>;
  cancelModelDownload: (engineName: string) => Promise<void>;
  pollDownloadStatus: (engineName: string) => void;
  stopDownloadPolling: (engineName: string) => void;
  clearDownloadState: (engineName: string) => void;
  initFromSettings: () => void;
}

// Track polling timeouts per engine
const _pollTimers: Record<string, ReturnType<typeof setTimeout>> = {};
const _downloadPollTimers: Record<string, ReturnType<typeof setTimeout>> = {};

// All engine keys: local + cloud + custom
export const ENGINE_KEYS = [
  "whisper", "qwen3", "paraformer",
  "openai-whisper", "alibaba-asr",
  "custom",
] as const;

export const CLOUD_ENGINES = new Set(["openai-whisper", "alibaba-asr"]);

// Fallback model sizes when ASR service is unavailable
export const FALLBACK_MODEL_SIZES: Record<string, string[]> = {
  whisper: ["tiny", "base", "small", "medium", "large-v3"],
  qwen3: ["qwen3-asr-0.6B", "qwen3-asr-1.7B"],
  paraformer: ["paraformer-large", "paraformer-large-vad-punc", "paraformer-large-vad-punc-spk"],
  "openai-whisper": ["whisper-1"],
  "alibaba-asr": ["paraformer-v2"],
  custom: [],  // populated dynamically from settingsStore.customASRModels
};

/** Check if a cloud engine has its API credentials configured (accepts cloudAsr for reactivity) */
export function isCloudEngineConfigured(
  engineName: string,
  cloudAsr: { openaiWhisper: { apiKey: string }; alibabaAsr: { keyId: string; secret: string } },
): boolean {
  switch (engineName) {
    case "openai-whisper":
      return !!cloudAsr.openaiWhisper.apiKey;
    case "alibaba-asr":
      return !!cloudAsr.alibabaAsr.keyId && !!cloudAsr.alibabaAsr.secret;
    default:
      return false;
  }
}

/** Check if an engine is available for use (local: loaded/downloaded, cloud: API configured) */
export function isEngineAvailable(
  engineName: string,
  engines: EngineInfo[],
  cloudAsr: { openaiWhisper: { apiKey: string }; alibabaAsr: { keyId: string; secret: string } },
): boolean {
  if (CLOUD_ENGINES.has(engineName)) {
    return isCloudEngineConfigured(engineName, cloudAsr);
  }
  const engine = engines.find((e) => e.name === engineName);
  if (!engine) return false;
  return engine.is_loaded || (engine.downloaded_models?.length ?? 0) > 0;
}

// Auto-recommendation logic based on language (prefers available engines)
function recommendEngine(language: string, engines: EngineInfo[]): string {
  const engineMap = Object.fromEntries(engines.map((e) => [e.name, e]));
  const cloudAsr = useSettingsStore.getState().cloudAsr;

  const avail = (name: string) => {
    const e = engineMap[name];
    if (!e) return false;
    return e.is_loaded || (e.downloaded_models?.length ?? 0) > 0;
  };

  // Standard Chinese → Qwen3 preferred, Paraformer fallback, then cloud
  if (language === "zh") {
    if (avail("qwen3")) return "qwen3";
    if (avail("paraformer")) return "paraformer";
    if (isCloudEngineConfigured("alibaba-asr", cloudAsr)) return "alibaba-asr";
  }

  // English or other → faster-whisper preferred, then OpenAI cloud
  if (avail("whisper")) return "whisper";
  if (isCloudEngineConfigured("openai-whisper", cloudAsr)) return "openai-whisper";

  // Last resort: return whisper even if unavailable (user will see disabled state)
  return "whisper";
}

function defaultModelSize(engine: string): string {
  switch (engine) {
    case "whisper":
      return "base";
    case "qwen3":
      return "qwen3-asr-0.6B";
    case "paraformer":
      return "paraformer-large";
    case "openai-whisper":
      return "whisper-1";
    case "alibaba-asr":
      return "paraformer-v2";
    default:
      return "base";
  }
}

export const useEngineStore = create<EngineStore>((set, get) => ({
  engines: [],
  selectedEngine: "whisper",
  selectedModelSize: "base",
  selectedLanguage: "auto",
  loading: false,
  loadingStates: {},
  downloadStates: {},

  fetchEngines: async () => {
    set({ loading: true });
    try {
      const engines = await api.listEngines();
      set({ engines, loading: false });

      // Sync stale backend download/load states with frontend
      for (const engine of engines) {
        try {
          const dlStatus = await api.getDownloadStatus(engine.name);
          if (dlStatus.phase === "downloading" && !get().downloadStates[engine.name]) {
            // Resume polling for in-progress downloads
            set((state) => ({
              downloadStates: {
                ...state.downloadStates,
                [engine.name]: {
                  phase: dlStatus.phase as api.DownloadPhase,
                  modelSize: dlStatus.model_size ?? "",
                  elapsedSeconds: dlStatus.elapsed_seconds,
                  downloadedBytes: dlStatus.downloaded_bytes ?? 0,
                  totalBytes: dlStatus.total_bytes ?? 0,
                  error: null,
                  modelName: dlStatus.model_name ?? null,
                },
              },
            }));
            get().pollDownloadStatus(engine.name);
          }
        } catch {
          // ASR service may not be ready yet
        }
        try {
          const ldStatus = await api.getLoadStatus(engine.name);
          if (
            (ldStatus.phase === "preparing" || ldStatus.phase === "loading") &&
            !get().loadingStates[engine.name]
          ) {
            set((state) => ({
              loadingStates: {
                ...state.loadingStates,
                [engine.name]: {
                  phase: ldStatus.phase as api.LoadPhase,
                  modelSize: ldStatus.model_size ?? "",
                  elapsedSeconds: ldStatus.elapsed_seconds,
                  error: null,
                },
              },
            }));
            get().pollLoadStatus(engine.name);
          }
        } catch {
          // ASR service may not be ready yet
        }
      }
    } catch {
      set({ loading: false });
    }
  },

  setSelectedEngine: (engine) => {
    const modelSize = defaultModelSize(engine);
    set({
      selectedEngine: engine,
      selectedModelSize: modelSize,
    });
    // Persist to settings
    useSettingsStore.getState().setGeneral({ asrEngine: engine, asrModelSize: modelSize });
  },

  setSelectedModelSize: (size) => {
    set({ selectedModelSize: size });
    // Persist to settings
    useSettingsStore.getState().setGeneral({ asrModelSize: size });
  },

  setSelectedLanguage: (lang) => {
    const { engines } = get();
    const recommended = recommendEngine(lang, engines);
    const modelSize = defaultModelSize(recommended);
    set({
      selectedLanguage: lang,
      selectedEngine: recommended,
      selectedModelSize: modelSize,
    });
    // Persist to settings
    useSettingsStore.getState().setGeneral({ asrEngine: recommended, asrModelSize: modelSize });
  },

  initFromSettings: () => {
    const { general } = useSettingsStore.getState();
    if (general.asrEngine) {
      set({
        selectedEngine: general.asrEngine,
        selectedModelSize: general.asrModelSize || defaultModelSize(general.asrEngine),
      });
    }
  },

  startModelLoad: async (engineName, modelSize) => {
    // Stop any existing polling for this engine
    get().stopPolling(engineName);

    // Set initial loading state
    set((state) => ({
      loadingStates: {
        ...state.loadingStates,
        [engineName]: {
          phase: "preparing",
          modelSize,
          elapsedSeconds: 0,
          error: null,
        },
      },
    }));

    try {
      const resp = await api.loadEngineModel(engineName, modelSize);
      if (resp.status === "already_loaded") {
        set((state) => ({
          loadingStates: {
            ...state.loadingStates,
            [engineName]: {
              phase: "ready",
              modelSize,
              elapsedSeconds: 0,
              error: null,
            },
          },
        }));
        await get().fetchEngines();
        return;
      }
      // Start polling for progress
      get().pollLoadStatus(engineName);
    } catch (err) {
      set((state) => ({
        loadingStates: {
          ...state.loadingStates,
          [engineName]: {
            phase: "error",
            modelSize,
            elapsedSeconds: 0,
            error: String(err),
          },
        },
      }));
    }
  },

  pollLoadStatus: (engineName) => {
    // Clear existing timer
    get().stopPolling(engineName);

    const MAX_RETRIES = 5;

    const poll = async (retryCount = 0) => {
      try {
        const status = await api.getLoadStatus(engineName);
        const currentState = get().loadingStates[engineName];
        if (!currentState) return; // Cleared externally

        set((state) => ({
          loadingStates: {
            ...state.loadingStates,
            [engineName]: {
              phase: status.phase,
              modelSize: status.model_size ?? currentState.modelSize,
              elapsedSeconds: status.elapsed_seconds,
              error: status.error,
            },
          },
        }));

        if (status.phase === "ready" || status.phase === "error") {
          delete _pollTimers[engineName];
          await get().fetchEngines();
          return;
        }

        // Continue polling (reset retry count on success)
        _pollTimers[engineName] = setTimeout(() => poll(0), 1500);
      } catch {
        if (retryCount >= MAX_RETRIES - 1) {
          // Stop polling after max retries
          set((state) => ({
            loadingStates: {
              ...state.loadingStates,
              [engineName]: {
                ...state.loadingStates[engineName],
                phase: "error" as api.LoadPhase,
                error: "ASR service unreachable",
              },
            },
          }));
          delete _pollTimers[engineName];
          return;
        }
        // Retry on network error
        _pollTimers[engineName] = setTimeout(() => poll(retryCount + 1), 3000);
      }
    };

    poll();
  },

  stopPolling: (engineName) => {
    const timer = _pollTimers[engineName];
    if (timer) {
      clearTimeout(timer);
      delete _pollTimers[engineName];
    }
  },

  clearLoadingState: (engineName) => {
    get().stopPolling(engineName);
    set((state) => {
      const { [engineName]: _, ...rest } = state.loadingStates;
      return { loadingStates: rest };
    });
  },

  cancelModelLoad: async (engineName) => {
    get().stopPolling(engineName);
    // Clear UI state immediately so cancel feels responsive
    set((state) => {
      const { [engineName]: _, ...rest } = state.loadingStates;
      return { loadingStates: rest };
    });
    try {
      await api.cancelLoad(engineName);
    } catch {
      // Best effort cancel
    }
    await get().fetchEngines();
  },

  startModelDownload: async (engineName, modelSize) => {
    get().stopDownloadPolling(engineName);

    set((state) => ({
      downloadStates: {
        ...state.downloadStates,
        [engineName]: {
          phase: "downloading",
          modelSize,
          elapsedSeconds: 0,
          downloadedBytes: 0,
          totalBytes: 0,
          error: null,
          modelName: null,
        },
      },
    }));

    try {
      const resp = await api.downloadEngineModel(engineName, modelSize);
      if (resp.status === "already_downloaded") {
        set((state) => ({
          downloadStates: {
            ...state.downloadStates,
            [engineName]: {
              phase: "completed",
              modelSize,
              elapsedSeconds: 0,
              downloadedBytes: 0,
              totalBytes: 0,
              error: null,
              modelName: null,
            },
          },
        }));
        await get().fetchEngines();
        return;
      }
      get().pollDownloadStatus(engineName);
    } catch (err) {
      set((state) => ({
        downloadStates: {
          ...state.downloadStates,
          [engineName]: {
            phase: "error",
            modelSize,
            elapsedSeconds: 0,
            downloadedBytes: 0,
            totalBytes: 0,
            error: String(err),
            modelName: null,
          },
        },
      }));
    }
  },

  cancelModelDownload: async (engineName) => {
    get().stopDownloadPolling(engineName);
    // Clear UI state immediately so cancel feels responsive
    set((state) => {
      const { [engineName]: _, ...rest } = state.downloadStates;
      return { downloadStates: rest };
    });
    // Notify backend (best effort — the underlying download thread will
    // eventually finish but its result is discarded)
    try {
      await api.cancelDownload(engineName);
    } catch {
      // Best effort cancel
    }
    await get().fetchEngines();
  },

  pollDownloadStatus: (engineName) => {
    get().stopDownloadPolling(engineName);

    const MAX_RETRIES = 5;

    const poll = async (retryCount = 0) => {
      try {
        const status = await api.getDownloadStatus(engineName);
        const currentState = get().downloadStates[engineName];
        if (!currentState) return;

        set((state) => ({
          downloadStates: {
            ...state.downloadStates,
            [engineName]: {
              phase: status.phase as api.DownloadPhase,
              modelSize: status.model_size ?? currentState.modelSize,
              elapsedSeconds: status.elapsed_seconds,
              downloadedBytes: status.downloaded_bytes ?? 0,
              totalBytes: status.total_bytes ?? 0,
              error: status.error,
              modelName: status.model_name ?? currentState.modelName,
            },
          },
        }));

        if (status.phase === "completed" || status.phase === "error") {
          delete _downloadPollTimers[engineName];
          await get().fetchEngines();
          return;
        }

        _downloadPollTimers[engineName] = setTimeout(() => poll(0), 1000);
      } catch {
        if (retryCount >= MAX_RETRIES - 1) {
          set((state) => ({
            downloadStates: {
              ...state.downloadStates,
              [engineName]: {
                ...state.downloadStates[engineName],
                phase: "error" as api.DownloadPhase,
                error: "ASR service unreachable",
              },
            },
          }));
          delete _downloadPollTimers[engineName];
          return;
        }
        _downloadPollTimers[engineName] = setTimeout(() => poll(retryCount + 1), 3000);
      }
    };

    poll();
  },

  stopDownloadPolling: (engineName) => {
    const timer = _downloadPollTimers[engineName];
    if (timer) {
      clearTimeout(timer);
      delete _downloadPollTimers[engineName];
    }
  },

  clearDownloadState: (engineName) => {
    get().stopDownloadPolling(engineName);
    set((state) => {
      const { [engineName]: _, ...rest } = state.downloadStates;
      return { downloadStates: rest };
    });
  },
}));
