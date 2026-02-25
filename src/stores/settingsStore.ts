import { create } from "zustand";
import { persist } from "zustand/middleware";

interface LLMProviderConfig {
  enabled: boolean;
  apiKey?: string;
  host?: string;
  model?: string;
}

interface GeneralConfig {
  defaultLLMProvider: string;
  autoSummary: boolean;
  exportFormat: "markdown" | "txt" | "json";
}

interface CloudAsrConfig {
  openaiWhisper: { apiKey: string };
  alibabaAsr: { keyId: string; secret: string };
}

interface SettingsStore {
  general: GeneralConfig;
  llmProviders: Record<string, LLMProviderConfig>;
  cloudAsr: CloudAsrConfig;
  autoDegradation: boolean;

  setGeneral: (updates: Partial<GeneralConfig>) => void;
  setLLMProvider: (key: string, updates: Partial<LLMProviderConfig>) => void;
  setCloudAsr: (provider: "openaiWhisper" | "alibabaAsr", updates: Record<string, string>) => void;
  setAutoDegradation: (enabled: boolean) => void;
}

export const useSettingsStore = create<SettingsStore>()(
  persist(
    (set, get) => ({
      general: {
        defaultLLMProvider: "ollama",
        autoSummary: true,
        exportFormat: "markdown",
      },
      llmProviders: {
        ollama: { enabled: true, host: "http://localhost:11434", model: "qwen2.5:7b" },
        deepseek: { enabled: false },
        qwen: { enabled: false },
        zhipu: { enabled: false },
        openai: { enabled: false },
        gemini: { enabled: false },
      },
      cloudAsr: {
        openaiWhisper: { apiKey: "" },
        alibabaAsr: { keyId: "", secret: "" },
      },
      autoDegradation: true,

      setGeneral: (updates) =>
        set({ general: { ...get().general, ...updates } }),

      setLLMProvider: (key, updates) =>
        set({
          llmProviders: {
            ...get().llmProviders,
            [key]: { ...get().llmProviders[key], ...updates },
          },
        }),

      setCloudAsr: (provider, updates) =>
        set({
          cloudAsr: {
            ...get().cloudAsr,
            [provider]: { ...get().cloudAsr[provider], ...updates },
          },
        }),

      setAutoDegradation: (enabled) => set({ autoDegradation: enabled }),
    }),
    { name: "openmeet-settings" }
  )
);
