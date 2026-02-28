import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";

export type ModelType = "LLM" | "EMBEDDING" | "RERANK";

export interface ProviderModelEntry {
  id: string;
  type: ModelType;
  enabled: boolean;
}

interface LLMProviderConfig {
  enabled: boolean;
  apiKey?: string;
  host?: string;
  model?: string;               // Keep for backward compatibility
  modelByType?: {               // Per-type model selection
    LLM?: string;
    EMBEDDING?: string;
    RERANK?: string;
  };
  models?: ProviderModelEntry[];  // Fetched + user-toggled model list
}

interface GeneralConfig {
  defaultLLMProvider: string;       // DEPRECATED: kept for migration
  defaultEmbeddingProvider: string; // DEPRECATED: kept for migration
  defaultRerankProvider: string;    // DEPRECATED: kept for migration
  defaultLLMModel: string;         // compound key "provider/model"
  defaultEmbeddingModel: string;   // compound key "provider/model"
  defaultRerankModel: string;      // compound key "provider/model"
  autoSummary: boolean;
  exportFormat: "markdown" | "txt" | "json";
  asrEngine: string;
  asrModelSize: string;
  modelCacheDir: string;
}

// Parse a compound model reference like "openai/gpt-4o"
export function parseModelRef(ref: string): { provider: string; model: string } {
  const idx = ref.indexOf("/");
  if (idx === -1) return { provider: ref, model: "" };
  return { provider: ref.slice(0, idx), model: ref.slice(idx + 1) };
}

// Build a compound model reference
export function makeModelRef(provider: string, model: string): string {
  return `${provider}/${model}`;
}

interface CloudAsrConfig {
  openaiWhisper: { apiKey: string; model?: string };
  alibabaAsr: { keyId: string; secret: string; model?: string };
}

interface SettingsStore {
  general: GeneralConfig;
  llmProviders: Record<string, LLMProviderConfig>;
  cloudAsr: CloudAsrConfig;
  autoDegradation: boolean;

  loadSettings: () => Promise<void>;
  setGeneral: (updates: Partial<GeneralConfig>) => Promise<void>;
  setLLMProvider: (key: string, updates: Partial<LLMProviderConfig>) => Promise<void>;
  setProviderModels: (providerKey: string, models: ProviderModelEntry[]) => Promise<void>;
  toggleModelEnabled: (providerKey: string, modelId: string, enabled: boolean) => Promise<void>;
  setCloudAsr: (provider: "openaiWhisper" | "alibabaAsr", updates: Record<string, string>) => Promise<void>;
  setAutoDegradation: (enabled: boolean) => Promise<void>;
}

const defaultState = {
  general: {
    defaultLLMProvider: "ollama",
    defaultEmbeddingProvider: "ollama",
    defaultRerankProvider: "qwen",
    defaultLLMModel: "",
    defaultEmbeddingModel: "",
    defaultRerankModel: "",
    autoSummary: true,
    exportFormat: "markdown" as const,
    asrEngine: "whisper",
    asrModelSize: "base",
    modelCacheDir: "",
  },
  llmProviders: {
    ollama: { enabled: true, host: "http://localhost:11434", model: "qwen2.5:7b", modelByType: { LLM: "qwen2.5:7b" } },
    deepseek: { enabled: false, model: "deepseek-chat", modelByType: { LLM: "deepseek-chat" } },
    qwen: { enabled: false, model: "qwen-plus", modelByType: { LLM: "qwen-plus" } },
    zhipu: { enabled: false, model: "glm-4-flash", modelByType: { LLM: "glm-4-flash" } },
    openai: { enabled: false, model: "gpt-4o-mini", modelByType: { LLM: "gpt-4o-mini" } },
    gemini: { enabled: false, model: "gemini-2.0-flash", modelByType: { LLM: "gemini-2.0-flash" } },
    moonshot: { enabled: false, model: "kimi-latest", modelByType: { LLM: "kimi-latest" } },
    wenxin: { enabled: false, model: "ernie-4.5-8k", modelByType: { LLM: "ernie-4.5-8k" } },
    hunyuan: { enabled: false, model: "hunyuan-turbos-latest", modelByType: { LLM: "hunyuan-turbos-latest" } },
    minimax: { enabled: false, model: "MiniMax-M1", modelByType: { LLM: "MiniMax-M1" } },
    siliconflow: { enabled: false, model: "Qwen/Qwen3-8B", modelByType: { LLM: "Qwen/Qwen3-8B" } },
    volcengine: { enabled: false, model: "doubao-1.5-pro-32k", modelByType: { LLM: "doubao-1.5-pro-32k" } },
  },
  cloudAsr: {
    openaiWhisper: { apiKey: "" },
    alibabaAsr: { keyId: "", secret: "" },
  },
  autoDegradation: true,
};

// Encrypt a secret string via Rust RSA-OAEP
async function encryptSecret(plaintext: string): Promise<string> {
  if (!plaintext) return "";
  try {
    return await invoke<string>("encrypt_secret", { plaintext });
  } catch {
    return plaintext; // Fallback to plaintext if encryption unavailable
  }
}

// Decrypt a secret string via Rust RSA-OAEP
async function decryptSecret(ciphertext: string): Promise<string> {
  if (!ciphertext) return "";
  try {
    return await invoke<string>("decrypt_secret", { ciphertext });
  } catch {
    // Decryption failed — if it looks like a valid API key (short, printable ASCII), return as-is
    if (ciphertext.length < 200 && /^[\x20-\x7E]+$/.test(ciphertext)) {
      return ciphertext;
    }
    // Looks like corrupted ciphertext — return empty to force re-entry
    return "";
  }
}

// Encrypt sensitive fields before persisting
async function encryptProviders(
  providers: Record<string, LLMProviderConfig>
): Promise<Record<string, LLMProviderConfig>> {
  const result: Record<string, LLMProviderConfig> = {};
  for (const [key, config] of Object.entries(providers)) {
    result[key] = { ...config };
    if (config.apiKey) {
      result[key].apiKey = await encryptSecret(config.apiKey);
    }
  }
  return result;
}

// Decrypt sensitive fields after loading
async function decryptProviders(
  providers: Record<string, LLMProviderConfig>
): Promise<Record<string, LLMProviderConfig>> {
  const result: Record<string, LLMProviderConfig> = {};
  for (const [key, config] of Object.entries(providers)) {
    result[key] = { ...config };
    if (config.apiKey) {
      result[key].apiKey = await decryptSecret(config.apiKey);
    }
  }
  return result;
}

async function persistSettings(state: {
  general: GeneralConfig;
  llmProviders: Record<string, LLMProviderConfig>;
  cloudAsr: CloudAsrConfig;
  autoDegradation: boolean;
}) {
  const encryptedProviders = await encryptProviders(state.llmProviders);
  const data = {
    general: state.general,
    llmProviders: encryptedProviders,
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
        const mergedProviders = { ...defaultState.llmProviders, ...data.llmProviders };
        // Migrate: if modelByType is missing but model exists, generate modelByType
        for (const key of Object.keys(mergedProviders)) {
          const cfg = mergedProviders[key];
          if ((!cfg.modelByType || Object.keys(cfg.modelByType).length === 0) && cfg.model) {
            mergedProviders[key] = { ...cfg, modelByType: { LLM: cfg.model } };
          }
        }

        const mergedGeneral = { ...defaultState.general, ...data.general };

        // Migrate: old provider-level defaults → new compound key defaults
        if (!mergedGeneral.defaultLLMModel && mergedGeneral.defaultLLMProvider) {
          const provider = mergedGeneral.defaultLLMProvider;
          const cfg = mergedProviders[provider];
          const model = cfg?.modelByType?.LLM || cfg?.model || "";
          if (model) {
            mergedGeneral.defaultLLMModel = `${provider}/${model}`;
          }
        }
        if (!mergedGeneral.defaultEmbeddingModel && mergedGeneral.defaultEmbeddingProvider) {
          const provider = mergedGeneral.defaultEmbeddingProvider;
          const cfg = mergedProviders[provider];
          const model = cfg?.modelByType?.EMBEDDING || "";
          if (model) {
            mergedGeneral.defaultEmbeddingModel = `${provider}/${model}`;
          }
        }
        if (!mergedGeneral.defaultRerankModel && mergedGeneral.defaultRerankProvider) {
          const provider = mergedGeneral.defaultRerankProvider;
          const cfg = mergedProviders[provider];
          const model = cfg?.modelByType?.RERANK || "";
          if (model) {
            mergedGeneral.defaultRerankModel = `${provider}/${model}`;
          }
        }

        const decrypted = await decryptProviders(mergedProviders);
        set({
          general: mergedGeneral,
          llmProviders: decrypted,
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
    // Keep deprecated provider fields in sync when compound key changes
    if (updates.defaultLLMModel) {
      newGeneral.defaultLLMProvider = parseModelRef(updates.defaultLLMModel).provider;
    }
    if (updates.defaultEmbeddingModel) {
      newGeneral.defaultEmbeddingProvider = parseModelRef(updates.defaultEmbeddingModel).provider;
    }
    if (updates.defaultRerankModel) {
      newGeneral.defaultRerankProvider = parseModelRef(updates.defaultRerankModel).provider;
    }
    set({ general: newGeneral });
    await persistSettings(get());
  },

  setLLMProvider: async (key, updates) => {
    const newProviders = {
      ...get().llmProviders,
      [key]: { ...get().llmProviders[key], ...updates },
    };
    set({ llmProviders: newProviders });
    await persistSettings({ ...get(), llmProviders: newProviders });
  },

  setProviderModels: async (providerKey, models) => {
    const current = get().llmProviders[providerKey];
    if (!current) return;
    const newProviders = {
      ...get().llmProviders,
      [providerKey]: { ...current, models },
    };
    set({ llmProviders: newProviders });
    await persistSettings({ ...get(), llmProviders: newProviders });
  },

  toggleModelEnabled: async (providerKey, modelId, enabled) => {
    const current = get().llmProviders[providerKey];
    if (!current?.models) return;
    const newModels = current.models.map((m) =>
      m.id === modelId ? { ...m, enabled } : m
    );
    const newProviders = {
      ...get().llmProviders,
      [providerKey]: { ...current, models: newModels },
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
