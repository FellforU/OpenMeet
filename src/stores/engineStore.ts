import { create } from "zustand";
import type { EngineInfo } from "../services/asrClient";
import * as api from "../services/asrClient";

interface EngineStore {
  engines: EngineInfo[];
  selectedEngine: string;
  selectedModelSize: string;
  selectedLanguage: string;
  loading: boolean;

  fetchEngines: () => Promise<void>;
  setSelectedEngine: (engine: string) => void;
  setSelectedModelSize: (size: string) => void;
  setSelectedLanguage: (lang: string) => void;
}

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
}));
