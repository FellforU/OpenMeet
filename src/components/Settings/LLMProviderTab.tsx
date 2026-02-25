import { useTranslation } from "react-i18next";
import { Shield, Server, Cloud } from "lucide-react";
import { Alert, AlertDescription } from "../ui/alert";
import { Input } from "../ui/input";
import { Switch } from "../ui/switch";
import { Badge } from "../ui/badge";
import { PasswordInput } from "./PasswordInput";

interface LLMProvider {
  key: string;
  type: "local" | "cloud";
  fields: ("host" | "model" | "apiKey")[];
  hostPlaceholder?: string;
  modelPlaceholder?: string;
  apiKeyPlaceholder?: string;
}

const LLM_PROVIDERS: LLMProvider[] = [
  {
    key: "ollama",
    type: "local",
    fields: ["host", "model"],
    hostPlaceholder: "http://localhost:11434",
    modelPlaceholder: "qwen2.5:7b",
  },
  {
    key: "deepseek",
    type: "cloud",
    fields: ["apiKey"],
    apiKeyPlaceholder: "sk-...",
  },
  {
    key: "qwen",
    type: "cloud",
    fields: ["apiKey"],
    apiKeyPlaceholder: "sk-...",
  },
  {
    key: "zhipu",
    type: "cloud",
    fields: ["apiKey"],
    apiKeyPlaceholder: "...",
  },
  {
    key: "openai",
    type: "cloud",
    fields: ["apiKey"],
    apiKeyPlaceholder: "sk-proj-...",
  },
  {
    key: "gemini",
    type: "cloud",
    fields: ["apiKey"],
    apiKeyPlaceholder: "AIza...",
  },
];

export function LLMProviderTab() {
  const { t } = useTranslation("settings");

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

      {LLM_PROVIDERS.map((provider) => (
        <div
          key={provider.key}
          className="space-y-3 rounded-lg border border-border p-4"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="font-medium">{t(`llm.${provider.key}`)}</span>
              <Badge
                variant={provider.type === "local" ? "secondary" : "outline"}
                className="gap-1 text-[10px]"
              >
                {provider.type === "local" ? (
                  <Server className="h-3 w-3" />
                ) : (
                  <Cloud className="h-3 w-3" />
                )}
                {t(`llm.${provider.type}`)}
              </Badge>
            </div>
            <Switch aria-label={t(`llm.${provider.key}`)} />
          </div>
          <p className="text-xs text-muted-foreground">
            {t(`llm.${provider.key}Desc`)}
          </p>

          {provider.fields.includes("host") && (
            <div className="space-y-1">
              <label htmlFor={`${provider.key}-host`} className="text-sm font-medium">
                {t("llm.ollamaHost")}
              </label>
              <Input
                id={`${provider.key}-host`}
                defaultValue={provider.hostPlaceholder}
                placeholder={provider.hostPlaceholder}
              />
            </div>
          )}

          {provider.fields.includes("model") && (
            <div className="space-y-1">
              <label htmlFor={`${provider.key}-model`} className="text-sm font-medium">
                {t("llm.ollamaModel")}
              </label>
              <Input
                id={`${provider.key}-model`}
                defaultValue={provider.modelPlaceholder}
                placeholder={provider.modelPlaceholder}
              />
            </div>
          )}

          {provider.fields.includes("apiKey") && (
            <div className="space-y-1">
              <label htmlFor={`${provider.key}-apikey`} className="text-sm font-medium">
                {t("llm.apiKey")}
              </label>
              <PasswordInput id={`${provider.key}-apikey`} placeholder={provider.apiKeyPlaceholder} />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
