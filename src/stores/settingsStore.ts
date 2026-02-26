import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";

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

  loadSettings: () => Promise<void>;
  setGeneral: (updates: Partial<GeneralConfig>) => Promise<void>;
  setLLMProvider: (key: string, updates: Partial<LLMProviderConfig>) => Promise<void>;
  setCloudAsr: (provider: "openaiWhisper" | "alibabaAsr", updates: Record<string, string>) => Promise<void>;
  setAutoDegradation: (enabled: boolean) => Promise<void>;
}

const defaultState = {
  general: {
    defaultLLMProvider: "ollama",
    autoSummary: true,
    exportFormat: "markdown" as const,
  },
  llmProviders: {
    ollama: { enabled: true, host: "http://localhost:11434", model: "qwen2.5:7b" },
    deepseek: { enabled: false, model: "deepseek-chat" },
    qwen: { enabled: false, model: "qwen-plus" },
    zhipu: { enabled: false, model: "glm-4-flash" },
    openai: { enabled: false, model: "gpt-4o-mini" },
    gemini: { enabled: false, model: "gemini-2.0-flash" },
  },
  cloudAsr: {
    openaiWhisper: { apiKey: "" },
    alibabaAsr: { keyId: "", secret: "" },
  },
  autoDegradation: true,
};

async function persistSettings(state: {
  general: GeneralConfig;
  llmProviders: Record<string, LLMProviderConfig>;
  cloudAsr: CloudAsrConfig;
  autoDegradation: boolean;
}) {
  const data = {
    general: state.general,
    llmProviders: state.llmProviders,
    cloudAsr: state.cloudAsr,
    autoDegradation: state.autoDegradation,
  };
  await invoke("db_set_setting", {
    key: "settings",
    value: JSON.stringify(data),
  });
}

export const useSettingsStore = create<SettingsStore>((set, get) => ({
  ...defaultState,

  loadSettings: async () => {
    const raw = await invoke<string | null>("db_get_setting", {
      key: "settings",
    });
    if (raw) {
      try {
        const data = JSON.parse(raw);
        set({
          general: { ...defaultState.general, ...data.general },
          llmProviders: { ...defaultState.llmProviders, ...data.llmProviders },
          cloudAsr: { ...defaultState.cloudAsr, ...data.cloudAsr },
          autoDegradation: data.autoDegradation ?? defaultState.autoDegradation,
        });
      } catch {
        // Use defaults on parse failure
      }
    }
  },

  setGeneral: async (updates) => {
    const newGeneral = { ...get().general, ...updates };
    set({ general: newGeneral });
    await persistSettings({ ...get(), general: newGeneral });
  },

  setLLMProvider: async (key, updates) => {
    const newProviders = {
      ...get().llmProviders,
      [key]: { ...get().llmProviders[key], ...updates },
    };
    set({ llmProviders: newProviders });
    await persistSettings({ ...get(), llmProviders: newProviders });
  },

  setCloudAsr: async (provider, updates) => {
    const newCloudAsr = {
      ...get().cloudAsr,
      [provider]: { ...get().cloudAsr[provider], ...updates },
    };
    set({ cloudAsr: newCloudAsr });
    await persistSettings({ ...get(), cloudAsr: newCloudAsr });
  },

  setAutoDegradation: async (enabled) => {
    set({ autoDegradation: enabled });
    await persistSettings({ ...get(), autoDegradation: enabled });
  },
}));
