import { useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Download, Trash2, Shield, Cloud } from "lucide-react";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";
import { Alert, AlertDescription } from "../ui/alert";
import { Input } from "../ui/input";
import { Switch } from "../ui/switch";
import { useEngineStore } from "../../stores/engineStore";
import { PasswordInput } from "./PasswordInput";

interface ModelInfo {
  engine: string;
  size: string;
  descKey: string;
  vramGb: number;
}

interface VendorGroup {
  engine: string;
  groupKey: string;
  variant: "default" | "secondary" | "outline";
  models: ModelInfo[];
}

const VENDOR_GROUPS: VendorGroup[] = [
  {
    engine: "whisper",
    groupKey: "whisperGroup",
    variant: "default",
    models: [
      { engine: "whisper", size: "tiny", descKey: "model.tiny", vramGb: 1 },
      { engine: "whisper", size: "base", descKey: "model.base", vramGb: 1.5 },
      { engine: "whisper", size: "small", descKey: "model.small", vramGb: 2 },
      { engine: "whisper", size: "medium", descKey: "model.medium", vramGb: 4 },
      { engine: "whisper", size: "large-v3", descKey: "model.large", vramGb: 6 },
    ],
  },
  {
    engine: "qwen3",
    groupKey: "qwen3Group",
    variant: "secondary",
    models: [
      { engine: "qwen3", size: "qwen3-asr-0.6B", descKey: "model.qwen06b", vramGb: 3 },
      { engine: "qwen3", size: "qwen3-asr-1.7B", descKey: "model.qwen17b", vramGb: 6 },
    ],
  },
  {
    engine: "paraformer",
    groupKey: "paraformerGroup",
    variant: "outline",
    models: [
      { engine: "paraformer", size: "paraformer-large", descKey: "model.paraStandard", vramGb: 2 },
      { engine: "paraformer", size: "paraformer-large-vad-punc", descKey: "model.paraVadPunc", vramGb: 2.5 },
      { engine: "paraformer", size: "paraformer-large-vad-punc-spk", descKey: "model.paraVadPuncSpk", vramGb: 3 },
    ],
  },
];

interface CloudASRProvider {
  key: string;
  fields: { label: string; placeholder: string; isPassword: boolean }[];
}

const CLOUD_ASR_PROVIDERS: CloudASRProvider[] = [
  {
    key: "openaiWhisper",
    fields: [
      { label: "llm.apiKey", placeholder: "sk-proj-...", isPassword: true },
    ],
  },
  {
    key: "alibabaAsr",
    fields: [
      { label: "asr.alibabaId", placeholder: "LTAI5t...", isPassword: false },
      { label: "asr.alibabaSecret", placeholder: "...", isPassword: true },
    ],
  },
];

export function ModelManager() {
  const { t } = useTranslation("settings");
  const { engines, fetchEngines } = useEngineStore();

  useEffect(() => {
    fetchEngines();
  }, [fetchEngines]);

  const loadedModels = useMemo(
    () =>
      new Set(
        engines
          .filter((e) => e.is_loaded && e.current_model_size)
          .map((e) => `${e.name}:${e.current_model_size}`)
      ),
    [engines]
  );

  return (
    <div className="space-y-6 py-2">
      {/* Header */}
      <div>
        <h3 className="text-lg font-semibold">{t("asr.title")}</h3>
        <p className="text-sm text-muted-foreground">{t("asr.subtitle")}</p>
      </div>

      {/* Vendor groups */}
      {VENDOR_GROUPS.map((group) => (
        <div key={group.engine} className="space-y-2">
          <div className="flex items-center gap-2">
            <Badge variant={group.variant}>{t(`common:engine.${group.engine}`)}</Badge>
            <span className="text-sm font-medium">{t(`asr.${group.groupKey}`)}</span>
          </div>
          <p className="text-xs text-muted-foreground">
            {t(`asr.${group.groupKey}Desc`)}
          </p>

          <div className="space-y-2 pl-2">
            {group.models.map((model) => {
              const key = `${model.engine}:${model.size}`;
              const isLoaded = loadedModels.has(key);

              return (
                <div
                  key={key}
                  className="flex items-center justify-between rounded-lg border border-border p-3"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{model.size}</span>
                      {isLoaded && (
                        <Badge variant="outline" className="text-green-600 border-green-300">
                          {t("common:status.loaded")}
                        </Badge>
                      )}
                    </div>
                    <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                      <span>{t(`common:${model.descKey}`)}</span>
                      <Badge variant="outline" className="text-[10px]">
                        {model.vramGb} GB VRAM
                      </Badge>
                    </div>
                  </div>
                  {isLoaded ? (
                    <Button variant="destructive" size="sm">
                      <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                      {t("common:action.unload")}
                    </Button>
                  ) : (
                    <Button variant="outline" size="sm">
                      <Download className="mr-1.5 h-3.5 w-3.5" />
                      {t("common:action.download")}
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}

      {/* Cloud ASR API Keys */}
      <div className="space-y-3 border-t pt-4">
        <div>
          <h4 className="text-base font-semibold">{t("asr.cloudTitle")}</h4>
          <p className="text-sm text-muted-foreground">{t("asr.cloudSubtitle")}</p>
        </div>

        <Alert>
          <Shield className="h-4 w-4" />
          <AlertDescription>{t("asr.securityNote")}</AlertDescription>
        </Alert>

        {CLOUD_ASR_PROVIDERS.map((provider) => (
          <div
            key={provider.key}
            className="space-y-3 rounded-lg border border-border p-4"
          >
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="gap-1">
                <Cloud className="h-3 w-3" />
                {t(`asr.${provider.key}`)}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground">
              {t(`asr.${provider.key}Desc`)}
            </p>
            {provider.fields.map((field, idx) => (
              <div key={`${provider.key}-${idx}`} className="space-y-1">
                <label htmlFor={`${provider.key}-${idx}`} className="text-sm font-medium">
                  {t(field.label)}
                </label>
                {field.isPassword ? (
                  <PasswordInput placeholder={field.placeholder} />
                ) : (
                  <Input placeholder={field.placeholder} />
                )}
              </div>
            ))}
          </div>
        ))}

        <div className="flex items-center justify-between">
          <div>
            <label className="text-sm font-medium">{t("asr.autoDegradation")}</label>
            <p className="text-xs text-muted-foreground">{t("asr.autoDegradationDesc")}</p>
          </div>
          <Switch defaultChecked />
        </div>
      </div>
    </div>
  );
}
