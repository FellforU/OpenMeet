import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Shield } from "lucide-react";
import { Alert, AlertDescription } from "../ui/alert";
import { useSettingsStore } from "../../stores/settingsStore";
import type { ModelType } from "../../stores/settingsStore";
import { ProviderCard } from "./ProviderCard";
import { ProviderConfigModal } from "./ProviderConfigModal";

import ollamaSvg from "@lobehub/icons-static-svg/icons/ollama.svg";
import deepseekSvg from "@lobehub/icons-static-svg/icons/deepseek-color.svg";
import qwenSvg from "@lobehub/icons-static-svg/icons/qwen-color.svg";
import zhipuSvg from "@lobehub/icons-static-svg/icons/zhipu-color.svg";
import openaiSvg from "@lobehub/icons-static-svg/icons/openai.svg";
import geminiSvg from "@lobehub/icons-static-svg/icons/gemini-color.svg";

export type { ModelType };

export interface LLMProviderDef {
  key: string;
  type: "local" | "cloud";
  logoSrc: string;
  brandColor: string;
  apiKeyUrl?: string;
  supportedTypes: ModelType[];
  fields: { key: string; labelKey: string; placeholder: string; isPassword: boolean }[];
  presetModelsByType: Record<string, string[]>;
  isConfigured: (config: { enabled: boolean; apiKey?: string; host?: string; model?: string }) => boolean;
}

export const LLM_PROVIDERS: LLMProviderDef[] = [
  {
    key: "ollama",
    type: "local",
    logoSrc: ollamaSvg,
    brandColor: "#000000",
    apiKeyUrl: "https://ollama.com/library",
    supportedTypes: ["LLM", "EMBEDDING"],
    fields: [
      { key: "host", labelKey: "settings:llm.ollamaHost", placeholder: "http://localhost:11434", isPassword: false },
    ],
    presetModelsByType: {
      LLM: [
        "qwen3:8b", "qwen3:14b", "qwen3:32b",
        "qwen2.5:7b", "qwen2.5:14b", "qwen2.5:32b",
        "deepseek-r1:8b", "deepseek-r1:32b",
        "llama4:scout", "llama3.2:8b",
        "gemma2:9b", "gemma2:27b",
        "mistral:7b", "glm4:9b",
      ],
      EMBEDDING: [
        "nomic-embed-text", "mxbai-embed-large",
        "all-minilm", "snowflake-arctic-embed",
      ],
    },
    isConfigured: (c) => Boolean(c.host),
  },
  {
    key: "deepseek",
    type: "cloud",
    logoSrc: deepseekSvg,
    brandColor: "#4D6BFE",
    apiKeyUrl: "https://platform.deepseek.com/api_keys",
    supportedTypes: ["LLM"],
    fields: [
      { key: "apiKey", labelKey: "settings:llm.apiKey", placeholder: "sk-...", isPassword: true },
    ],
    presetModelsByType: {
      LLM: ["deepseek-chat", "deepseek-reasoner"],
    },
    isConfigured: (c) => Boolean(c.apiKey),
  },
  {
    key: "qwen",
    type: "cloud",
    logoSrc: qwenSvg,
    brandColor: "#5B43D4",
    apiKeyUrl: "https://dashscope.console.aliyun.com/apiKey",
    supportedTypes: ["LLM", "EMBEDDING", "RERANK"],
    fields: [
      { key: "apiKey", labelKey: "settings:llm.apiKey", placeholder: "sk-...", isPassword: true },
    ],
    presetModelsByType: {
      LLM: [
        "qwen3.5-plus", "qwen3.5-flash",
        "qwen3-max", "qwen-plus-latest",
        "qwen-turbo-latest", "qwen-max-latest",
        "qwq-plus",
      ],
      EMBEDDING: [
        "text-embedding-v3", "text-embedding-v2",
      ],
      RERANK: [
        "gte-rerank-v2", "gte-rerank",
      ],
    },
    isConfigured: (c) => Boolean(c.apiKey),
  },
  {
    key: "zhipu",
    type: "cloud",
    logoSrc: zhipuSvg,
    brandColor: "#3859FF",
    apiKeyUrl: "https://open.bigmodel.cn/usercenter/apikeys",
    supportedTypes: ["LLM", "EMBEDDING"],
    fields: [
      { key: "apiKey", labelKey: "settings:llm.apiKey", placeholder: "...", isPassword: true },
    ],
    presetModelsByType: {
      LLM: [
        "glm-5", "glm-4.7", "glm-4.7-flash",
        "glm-4-plus", "glm-4-flash-250414",
        "glm-z1-flash", "glm-z1-airx", "glm-z1-air",
      ],
      EMBEDDING: [
        "embedding-3", "embedding-2",
      ],
    },
    isConfigured: (c) => Boolean(c.apiKey),
  },
  {
    key: "openai",
    type: "cloud",
    logoSrc: openaiSvg,
    brandColor: "#10A37F",
    apiKeyUrl: "https://platform.openai.com/api-keys",
    supportedTypes: ["LLM", "EMBEDDING"],
    fields: [
      { key: "apiKey", labelKey: "settings:llm.apiKey", placeholder: "sk-proj-...", isPassword: true },
    ],
    presetModelsByType: {
      LLM: [
        "gpt-5.2", "gpt-5.2-pro",
        "gpt-4.1", "gpt-4.1-mini", "gpt-4.1-nano",
        "gpt-4o", "gpt-4o-mini",
        "o3", "o3-pro", "o4-mini",
      ],
      EMBEDDING: [
        "text-embedding-3-large", "text-embedding-3-small",
        "text-embedding-ada-002",
      ],
    },
    isConfigured: (c) => Boolean(c.apiKey),
  },
  {
    key: "gemini",
    type: "cloud",
    logoSrc: geminiSvg,
    brandColor: "#8E75B6",
    apiKeyUrl: "https://aistudio.google.com/apikey",
    supportedTypes: ["LLM", "EMBEDDING"],
    fields: [
      { key: "apiKey", labelKey: "settings:llm.apiKey", placeholder: "AIza...", isPassword: true },
    ],
    presetModelsByType: {
      LLM: [
        "gemini-3.1-pro-preview", "gemini-3-flash-preview", "gemini-3-pro-preview",
        "gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-2.5-pro",
      ],
      EMBEDDING: [
        "text-embedding-004", "embedding-001",
      ],
    },
    isConfigured: (c) => Boolean(c.apiKey),
  },
];

export function LLMProviderTab() {
  const { t } = useTranslation("settings");
  const { llmProviders, setLLMProvider } = useSettingsStore();
  const [configuring, setConfiguring] = useState<string | null>(null);

  const configuringDef = configuring
    ? LLM_PROVIDERS.find((p) => p.key === configuring)
    : null;

  const configured = LLM_PROVIDERS.filter((p) =>
    p.isConfigured(llmProviders[p.key] || { enabled: false })
  );
  const notConfigured = LLM_PROVIDERS.filter(
    (p) => !p.isConfigured(llmProviders[p.key] || { enabled: false })
  );

  const handleSave = (config: Record<string, unknown>) => {
    if (!configuring) return;
    setLLMProvider(configuring, config);
  };

  const getConfig = (key: string) => {
    return llmProviders[key] || { enabled: false };
  };

  return (
    <div className="space-y-4 py-2">
      <div>
        <h3 className="text-lg font-semibold">{t("llm.title")}</h3>
        <p className="text-sm text-muted-foreground">{t("llm.subtitle")}</p>
      </div>

      <Alert>
        <Shield className="h-4 w-4" />
        <AlertDescription>{t("llm.securityNote")}</AlertDescription>
      </Alert>

      {configured.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-sm font-medium text-muted-foreground">
            {t("llm.configured")}
          </h4>
          <div className="grid gap-2">
            {configured.map((provider) => {
              const models = llmProviders[provider.key]?.models;
              const enabledModelCount = models
                ? models.filter((m) => m.enabled).length
                : undefined;
              return (
                <ProviderCard
                  key={provider.key}
                  logoSrc={provider.logoSrc}
                  brandColor={provider.brandColor}
                  name={t(`llm.${provider.key}`)}
                  description={t(`llm.${provider.key}Desc`)}
                  type={provider.type}
                  supportedTypes={provider.supportedTypes}
                  isConfigured
                  isEnabled={llmProviders[provider.key]?.enabled}
                  modelCount={enabledModelCount}
                  onToggleEnabled={(val) =>
                    setLLMProvider(provider.key, { enabled: val })
                  }
                  onClick={() => setConfiguring(provider.key)}
                />
              );
            })}
          </div>
        </div>
      )}

      {notConfigured.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-sm font-medium text-muted-foreground">
            {t("llm.notConfigured")}
          </h4>
          <div className="grid gap-2">
            {notConfigured.map((provider) => (
              <ProviderCard
                key={provider.key}
                logoSrc={provider.logoSrc}
                brandColor={provider.brandColor}
                name={t(`llm.${provider.key}`)}
                description={t(`llm.${provider.key}Desc`)}
                type={provider.type}
                supportedTypes={provider.supportedTypes}
                isConfigured={false}
                onClick={() => setConfiguring(provider.key)}
              />
            ))}
          </div>
        </div>
      )}

      {configuringDef && (
        <ProviderConfigModal
          open={Boolean(configuring)}
          onClose={() => setConfiguring(null)}
          logoSrc={configuringDef.logoSrc}
          providerKey={configuringDef.key}
          providerName={t(`llm.${configuringDef.key}`)}
          fields={configuringDef.fields}
          presetModelsByType={configuringDef.presetModelsByType}
          supportedTypes={configuringDef.supportedTypes}
          apiKeyUrl={configuringDef.apiKeyUrl}
          config={getConfig(configuringDef.key)}
          onSave={handleSave}
        />
      )}
    </div>
  );
}
