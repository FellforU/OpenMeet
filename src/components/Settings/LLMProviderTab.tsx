import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Shield } from "lucide-react";
import { Alert, AlertDescription } from "../ui/alert";
import { useSettingsStore } from "../../stores/settingsStore";
import { ProviderCard } from "./ProviderCard";
import { ProviderConfigModal } from "./ProviderConfigModal";

import ollamaSvg from "@lobehub/icons-static-svg/icons/ollama.svg";
import deepseekSvg from "@lobehub/icons-static-svg/icons/deepseek-color.svg";
import qwenSvg from "@lobehub/icons-static-svg/icons/qwen-color.svg";
import zhipuSvg from "@lobehub/icons-static-svg/icons/zhipu-color.svg";
import openaiSvg from "@lobehub/icons-static-svg/icons/openai.svg";
import geminiSvg from "@lobehub/icons-static-svg/icons/gemini-color.svg";

interface LLMProviderDef {
  key: string;
  type: "local" | "cloud";
  logoSrc: string;
  brandColor: string;
  fields: { key: string; labelKey: string; placeholder: string; isPassword: boolean }[];
  isConfigured: (config: { enabled: boolean; apiKey?: string; host?: string; model?: string }) => boolean;
}

const LLM_PROVIDERS: LLMProviderDef[] = [
  {
    key: "ollama",
    type: "local",
    logoSrc: ollamaSvg,
    brandColor: "#000000",
    fields: [
      { key: "host", labelKey: "settings:llm.ollamaHost", placeholder: "http://localhost:11434", isPassword: false },
      { key: "model", labelKey: "settings:llm.ollamaModel", placeholder: "qwen2.5:7b", isPassword: false },
    ],
    isConfigured: (c) => Boolean(c.host),
  },
  {
    key: "deepseek",
    type: "cloud",
    logoSrc: deepseekSvg,
    brandColor: "#4D6BFE",
    fields: [{ key: "apiKey", labelKey: "settings:llm.apiKey", placeholder: "sk-...", isPassword: true }],
    isConfigured: (c) => Boolean(c.apiKey),
  },
  {
    key: "qwen",
    type: "cloud",
    logoSrc: qwenSvg,
    brandColor: "#5B43D4",
    fields: [{ key: "apiKey", labelKey: "settings:llm.apiKey", placeholder: "sk-...", isPassword: true }],
    isConfigured: (c) => Boolean(c.apiKey),
  },
  {
    key: "zhipu",
    type: "cloud",
    logoSrc: zhipuSvg,
    brandColor: "#3859FF",
    fields: [{ key: "apiKey", labelKey: "settings:llm.apiKey", placeholder: "...", isPassword: true }],
    isConfigured: (c) => Boolean(c.apiKey),
  },
  {
    key: "openai",
    type: "cloud",
    logoSrc: openaiSvg,
    brandColor: "#10A37F",
    fields: [{ key: "apiKey", labelKey: "settings:llm.apiKey", placeholder: "sk-proj-...", isPassword: true }],
    isConfigured: (c) => Boolean(c.apiKey),
  },
  {
    key: "gemini",
    type: "cloud",
    logoSrc: geminiSvg,
    brandColor: "#8E75B6",
    fields: [{ key: "apiKey", labelKey: "settings:llm.apiKey", placeholder: "AIza...", isPassword: true }],
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

  const handleSave = (values: Record<string, string>) => {
    if (!configuring) return;
    setLLMProvider(configuring, values);
  };

  const getValues = (key: string): Record<string, string> => {
    const cfg = llmProviders[key] || {};
    const result: Record<string, string> = {};
    for (const [k, v] of Object.entries(cfg)) {
      if (typeof v === "string") result[k] = v;
    }
    return result;
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
            {configured.map((provider) => (
              <ProviderCard
                key={provider.key}
                logoSrc={provider.logoSrc}
                brandColor={provider.brandColor}
                name={t(`llm.${provider.key}`)}
                description={t(`llm.${provider.key}Desc`)}
                type={provider.type}
                isConfigured
                isEnabled={llmProviders[provider.key]?.enabled}
                onToggleEnabled={(val) =>
                  setLLMProvider(provider.key, { enabled: val })
                }
                onClick={() => setConfiguring(provider.key)}
              />
            ))}
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
          providerName={t(`llm.${configuringDef.key}`)}
          fields={configuringDef.fields}
          values={getValues(configuringDef.key)}
          onSave={handleSave}
        />
      )}
    </div>
  );
}
