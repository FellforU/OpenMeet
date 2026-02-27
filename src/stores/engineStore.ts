import { create } from "zustand";
import type { EngineInfo } from "../services/asrClient";
import * as api from "../services/asrClient";

interface ModelLoadingState {
  phase: api.LoadPhase;
  modelSize: string;
  elapsedSeconds: number;
  error: string | null;
}

interface EngineStore {
  engines: EngineInfo[];
  selectedEngine: string;
  selectedModelSize: string;
  selectedLanguage: string;
  loading: boolean;
  loadingStates: Record<string, ModelLoadingState>;

  fetchEngines: () => Promise<void>;
  setSelectedEngine: (engine: string) => void;
  setSelectedModelSize: (size: string) => void;
  setSelectedLanguage: (lang: string) => void;
  startModelLoad: (engineName: string, modelSize: string) => Promise<void>;
  pollLoadStatus: (engineName: string) => void;
  stopPolling: (engineName: string) => void;
  clearLoadingState: (engineName: string) => void;
}

// Track polling timeouts per engine
const _pollTimers: Record<string, ReturnType<typeof setTimeout>> = {};

// Fallback model sizes when ASR service is unavailable
export const FALLBACK_MODEL_SIZES: Record<string, string[]> = {
  whisper: ["tiny", "base", "small", "medium", "large-v3"],
  qwen3: ["qwen3-asr-0.6B", "qwen3-asr-1.7B"],
  paraformer: ["paraformer-large", "paraformer-large-vad-punc", "paraformer-large-vad-punc-spk"],
};

// Auto-recommendation logic based on language
function recommendEngine(language: string, engines: EngineInfo[]): string {
  const engineMap = Object.fromEntries(engines.map((e) => [e.name, e]));

  // Chinese dialects → Qwen3-ASR (only engine supporting dialects)
  const dialectCodes = ["yue", "wuu", "min_nan", "gan", "hakka", "xiang"];
  if (dialectCodes.includes(language)) {
    if (engineMap["qwen3"]) return "qwen3";
  }

  // Standard Chinese → Qwen3 preferred, Paraformer fallback
  if (language === "zh") {
    if (engineMap["qwen3"]) return "qwen3";
    if (engineMap["paraformer"]) return "paraformer";
  }

  // English or other → faster-whisper
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

  fetchEngines: async () => {
    set({ loading: true });
    try {
      const engines = await api.listEngines();
      set({ engines, loading: false });
    } catch {
      set({ loading: false });
    }
  },

  setSelectedEngine: (engine) => {
    set({
      selectedEngine: engine,
      selectedModelSize: defaultModelSize(engine),
    });
  },

  setSelectedModelSize: (size) => {
    set({ selectedModelSize: size });
  },

  setSelectedLanguage: (lang) => {
    const { engines } = get();
    const recommended = recommendEngine(lang, engines);
    set({
      selectedLanguage: lang,
      selectedEngine: recommended,
      selectedModelSize: defaultModelSize(recommended),
    });
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
}));
