import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Download, Trash2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";
import { Switch } from "../ui/switch";
import { useEngineStore } from "../../stores/engineStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { ProviderCard } from "./ProviderCard";
import { ProviderConfigModal } from "./ProviderConfigModal";
import * as api from "../../services/asrClient";

import openaiSvg from "@lobehub/icons-static-svg/icons/openai.svg";
import alibabaSvg from "@lobehub/icons-static-svg/icons/alibabacloud-color.svg";

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

interface CloudAsrDef {
  providerKey: "openaiWhisper" | "alibabaAsr";
  engineName: string;
  logoSrc: string;
  brandColor: string;
  fields: { key: string; labelKey: string; placeholder: string; isPassword: boolean }[];
  isConfigured: (vals: Record<string, string>) => boolean;
  toCredentials: (vals: Record<string, string>) => Record<string, string>;
}

const CLOUD_ASR_DEFS: CloudAsrDef[] = [
  {
    providerKey: "openaiWhisper",
    engineName: "openai-whisper",
    logoSrc: openaiSvg,
    brandColor: "#10A37F",
    fields: [
      { key: "apiKey", labelKey: "settings:llm.apiKey", placeholder: "sk-proj-...", isPassword: true },
    ],
    isConfigured: (v) => Boolean(v.apiKey),
    toCredentials: (v) => ({ api_key: v.apiKey }),
  },
  {
    providerKey: "alibabaAsr",
    engineName: "alibaba-asr",
    logoSrc: alibabaSvg,
    brandColor: "#FF6A00",
    fields: [
      { key: "keyId", labelKey: "settings:asr.alibabaId", placeholder: "LTAI5t...", isPassword: false },
      { key: "secret", labelKey: "settings:asr.alibabaSecret", placeholder: "...", isPassword: true },
    ],
    isConfigured: (v) => Boolean(v.keyId && v.secret),
    toCredentials: (v) => ({ access_key_id: v.keyId, access_key_secret: v.secret }),
  },
];

export function ModelManager() {
  const { t } = useTranslation("settings");
  const { engines, fetchEngines } = useEngineStore();
  const { cloudAsr, setCloudAsr, autoDegradation, setAutoDegradation } =
    useSettingsStore();
  const [loadingKey, setLoadingKey] = useState<string | null>(null);
  const [configuringAsr, setConfiguringAsr] = useState<string | null>(null);

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

  const handleLoad = async (engine: string, size: string) => {
    const key = `${engine}:${size}`;
    setLoadingKey(key);
    try {
      await api.loadEngineModel(engine, size);
      await fetchEngines();
    } catch (err) {
      toast.error(String(err));
    } finally {
      setLoadingKey(null);
    }
  };

  const handleUnload = async (engine: string) => {
    setLoadingKey(`${engine}:unload`);
    try {
      await api.unloadEngineModel(engine);
      await fetchEngines();
    } catch (err) {
      toast.error(String(err));
    } finally {
      setLoadingKey(null);
    }
  };

  const configuringDef = configuringAsr
    ? CLOUD_ASR_DEFS.find((d) => d.providerKey === configuringAsr)
    : null;

  const getCloudValues = (key: "openaiWhisper" | "alibabaAsr"): Record<string, string> => {
    const cfg = cloudAsr[key];
    const result: Record<string, string> = {};
    for (const [k, v] of Object.entries(cfg)) {
      if (typeof v === "string") result[k] = v;
    }
    return result;
  };

  const handleCloudSave = async (values: Record<string, string>) => {
    if (!configuringDef) return;
    setCloudAsr(configuringDef.providerKey, values);
    try {
      await api.configureEngine(
        configuringDef.engineName,
        configuringDef.toCredentials(values)
      );
      toast.success(t("llm.credentialsSaved"));
    } catch {
      // Credentials saved locally even if push fails
    }
  };

  return (
    <div className="space-y-6 py-2">
      <div>
        <h3 className="text-lg font-semibold">{t("asr.title")}</h3>
        <p className="text-sm text-muted-foreground">{t("asr.subtitle")}</p>
      </div>

      {/* Local ASR vendor groups */}
      {VENDOR_GROUPS.map((group) => (
        <div key={group.engine} className="space-y-2">
          <div className="flex items-center gap-2">
            <Badge variant={group.variant}>
              {t(`common:engine.${group.engine}`)}
            </Badge>
            <span className="text-sm font-medium">
              {t(`asr.${group.groupKey}`)}
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            {t(`asr.${group.groupKey}Desc`)}
          </p>

          <div className="space-y-2 pl-2">
            {group.models.map((model) => {
              const key = `${model.engine}:${model.size}`;
              const isLoaded = loadedModels.has(key);
              const isOperating = loadingKey === key || loadingKey === `${model.engine}:unload`;

              return (
                <div
                  key={key}
                  className="flex items-center justify-between rounded-lg border border-border p-3"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{model.size}</span>
                      {isLoaded && (
                        <Badge
                          variant="outline"
                          className="border-green-300 text-green-600"
                        >
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
                    <Button
                      variant="destructive"
                      size="sm"
                      disabled={isOperating}
                      onClick={() => handleUnload(model.engine)}
                    >
                      {isOperating ? (
                        <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                      )}
                      {t("common:action.unload")}
                    </Button>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={isOperating}
                      onClick={() => handleLoad(model.engine, model.size)}
                    >
                      {isOperating ? (
                        <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Download className="mr-1.5 h-3.5 w-3.5" />
                      )}
                      {t("common:action.load")}
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}

      {/* Cloud ASR — Dify-style cards */}
      <div className="space-y-3 border-t pt-4">
        <div>
          <h4 className="text-base font-semibold">{t("asr.cloudTitle")}</h4>
          <p className="text-sm text-muted-foreground">
            {t("asr.cloudSubtitle")}
          </p>
        </div>

        <div className="grid gap-2">
          {CLOUD_ASR_DEFS.map((def) => {
            const vals = getCloudValues(def.providerKey);
            return (
              <ProviderCard
                key={def.providerKey}
                logoSrc={def.logoSrc}
                brandColor={def.brandColor}
                name={t(`asr.${def.providerKey}`)}
                description={t(`asr.${def.providerKey}Desc`)}
                type="cloud"
                isConfigured={def.isConfigured(vals)}
                onClick={() => setConfiguringAsr(def.providerKey)}
              />
            );
          })}
        </div>

        <div className="flex items-center justify-between">
          <div>
            <label className="text-sm font-medium">
              {t("asr.autoDegradation")}
            </label>
            <p className="text-xs text-muted-foreground">
              {t("asr.autoDegradationDesc")}
            </p>
          </div>
          <Switch
            checked={autoDegradation}
            onCheckedChange={setAutoDegradation}
          />
        </div>
      </div>

      {configuringDef && (
        <ProviderConfigModal
          open={Boolean(configuringAsr)}
          onClose={() => setConfiguringAsr(null)}
          logoSrc={configuringDef.logoSrc}
          providerKey={configuringDef.providerKey}
          providerName={t(`asr.${configuringDef.providerKey}`)}
          fields={configuringDef.fields}
          presetModels={[]}
          values={getCloudValues(configuringDef.providerKey)}
          onSave={handleCloudSave}
        />
      )}
    </div>
  );
}
