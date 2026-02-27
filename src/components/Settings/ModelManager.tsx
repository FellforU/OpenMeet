import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Download, Trash2, Loader2, Settings as SettingsIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";
import { Switch } from "../ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { useEngineStore } from "../../stores/engineStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { ProviderCard } from "./ProviderCard";
import { ProviderConfigModal } from "./ProviderConfigModal";
import * as api from "../../services/asrClient";

import openaiSvg from "@lobehub/icons-static-svg/icons/openai.svg";
import qwenSvg from "@lobehub/icons-static-svg/icons/qwen-color.svg";
import alibabaSvg from "@lobehub/icons-static-svg/icons/alibabacloud-color.svg";

interface ModelInfo {
  size: string;
  descKey: string;
  vramGb: number;
}

interface VendorDef {
  engine: string;
  logoSrc: string;
  brandColor: string;
  models: ModelInfo[];
}

const VENDOR_DEFS: VendorDef[] = [
  {
    engine: "whisper",
    logoSrc: openaiSvg,
    brandColor: "#10A37F",
    models: [
      { size: "tiny", descKey: "model.tiny", vramGb: 1 },
      { size: "base", descKey: "model.base", vramGb: 1.5 },
      { size: "small", descKey: "model.small", vramGb: 2 },
      { size: "medium", descKey: "model.medium", vramGb: 4 },
      { size: "large-v3", descKey: "model.large", vramGb: 6 },
    ],
  },
  {
    engine: "qwen3",
    logoSrc: qwenSvg,
    brandColor: "#5B43D4",
    models: [
      { size: "qwen3-asr-0.6B", descKey: "model.qwen06b", vramGb: 3 },
      { size: "qwen3-asr-1.7B", descKey: "model.qwen17b", vramGb: 6 },
    ],
  },
  {
    engine: "paraformer",
    logoSrc: alibabaSvg,
    brandColor: "#FF6A00",
    models: [
      { size: "paraformer-large", descKey: "model.paraStandard", vramGb: 2 },
      { size: "paraformer-large-vad-punc", descKey: "model.paraVadPunc", vramGb: 2.5 },
      { size: "paraformer-large-vad-punc-spk", descKey: "model.paraVadPuncSpk", vramGb: 3 },
    ],
  },
];

interface CloudAsrDef {
  providerKey: "openaiWhisper" | "alibabaAsr";
  engineName: string;
  logoSrc: string;
  brandColor: string;
  fields: { key: string; labelKey: string; placeholder: string; isPassword: boolean }[];
  presetModels: string[];
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
      { key: "model", labelKey: "settings:llm.model", placeholder: "whisper-1", isPassword: false },
    ],
    presetModels: ["whisper-1"],
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
      { key: "model", labelKey: "settings:llm.model", placeholder: "paraformer-v2", isPassword: false },
    ],
    presetModels: ["paraformer-v2", "paraformer-realtime-v2"],
    isConfigured: (v) => Boolean(v.keyId && v.secret),
    toCredentials: (v) => ({ access_key_id: v.keyId, access_key_secret: v.secret }),
  },
];

// Vendor card config modal
function VendorConfigModal({
  open,
  onClose,
  vendor,
  loadedModels,
  loadingKey,
  onLoad,
  onUnload,
}: {
  open: boolean;
  onClose: () => void;
  vendor: VendorDef;
  loadedModels: Set<string>;
  loadingKey: string | null;
  onLoad: (engine: string, size: string) => void;
  onUnload: (engine: string) => void;
}) {
  const { t } = useTranslation("settings");

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <img src={vendor.logoSrc} alt={vendor.engine} className="h-6 w-6" />
            <DialogTitle>
              {t(`asr.${vendor.engine}Group`)}
            </DialogTitle>
          </div>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          {t(`asr.${vendor.engine}GroupDesc`)}
        </p>
        <div className="mt-2 space-y-2">
          {vendor.models.map((model) => {
            const key = `${vendor.engine}:${model.size}`;
            const isLoaded = loadedModels.has(key);
            const isOperating = loadingKey === key || loadingKey === `${vendor.engine}:unload`;

            return (
              <div
                key={key}
                className="flex items-center justify-between rounded-lg border border-border p-3"
              >
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{model.size}</span>
                    {isLoaded && (
                      <Badge variant="outline" className="border-green-300 text-green-600">
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
                    onClick={() => onUnload(vendor.engine)}
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
                    onClick={() => onLoad(vendor.engine, model.size)}
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
      </DialogContent>
    </Dialog>
  );
}

export function ModelManager() {
  const { t } = useTranslation("settings");
  const { engines, fetchEngines } = useEngineStore();
  const { cloudAsr, setCloudAsr, autoDegradation, setAutoDegradation } =
    useSettingsStore();
  const [loadingKey, setLoadingKey] = useState<string | null>(null);
  const [configuringVendor, setConfiguringVendor] = useState<string | null>(null);
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

  const configuringVendorDef = configuringVendor
    ? VENDOR_DEFS.find((v) => v.engine === configuringVendor)
    : null;

  const getCloudValues = (key: "openaiWhisper" | "alibabaAsr"): Record<string, string> => {
    const cfg = cloudAsr[key];
    const result: Record<string, string> = {};
    for (const [k, v] of Object.entries(cfg)) {
      if (typeof v === "string") result[k] = v;
    }
    return result;
  };

  const handleCloudSave = async (values: Record<string, unknown>) => {
    if (!configuringDef) return;
    // Extract string values for Cloud ASR config
    const stringValues: Record<string, string> = {};
    for (const [k, v] of Object.entries(values)) {
      if (typeof v === "string") stringValues[k] = v;
    }
    setCloudAsr(configuringDef.providerKey, stringValues);
    try {
      await api.configureEngine(
        configuringDef.engineName,
        configuringDef.toCredentials(stringValues)
      );
      toast.success(t("llm.credentialsSaved"));
    } catch {
      // Credentials saved locally even if push fails
    }
  };

  // Get loaded status for a vendor
  const getVendorStatus = (engine: string): string | null => {
    const loaded = engines.find((e) => e.name === engine && e.is_loaded);
    return loaded?.current_model_size || null;
  };

  return (
    <div className="space-y-6 py-2">
      <div>
        <h3 className="text-lg font-semibold">{t("asr.title")}</h3>
        <p className="text-sm text-muted-foreground">{t("asr.subtitle")}</p>
      </div>

      {/* Local ASR vendor cards */}
      <div className="grid gap-2">
        {VENDOR_DEFS.map((vendor) => {
          const loadedSize = getVendorStatus(vendor.engine);
          return (
            <div
              key={vendor.engine}
              className="flex cursor-pointer items-center gap-3 rounded-lg border border-border p-3 transition-colors hover:bg-accent/50"
              onClick={() => setConfiguringVendor(vendor.engine)}
            >
              <div
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg"
                style={{ backgroundColor: `${vendor.brandColor}10` }}
              >
                <img src={vendor.logoSrc} alt={vendor.engine} className="h-6 w-6" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium">
                    {t(`asr.${vendor.engine}Group`)}
                  </span>
                  <Badge variant="secondary" className="gap-1 text-[10px]">
                    {t("llm.local")}
                  </Badge>
                  {loadedSize && (
                    <Badge variant="outline" className="gap-1 border-green-300 text-[10px] text-green-600">
                      {loadedSize}
                    </Badge>
                  )}
                </div>
                <p className="mt-0.5 truncate text-xs text-muted-foreground">
                  {t(`asr.${vendor.engine}GroupDesc`)}
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={(e) => {
                  e.stopPropagation();
                  setConfiguringVendor(vendor.engine);
                }}
              >
                <SettingsIcon className="mr-1.5 h-3.5 w-3.5" />
                {t("llm.configureBtn")}
              </Button>
            </div>
          );
        })}
      </div>

      {/* Cloud ASR cards */}
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

      {/* Vendor config modal */}
      {configuringVendorDef && (
        <VendorConfigModal
          open={Boolean(configuringVendor)}
          onClose={() => setConfiguringVendor(null)}
          vendor={configuringVendorDef}
          loadedModels={loadedModels}
          loadingKey={loadingKey}
          onLoad={handleLoad}
          onUnload={handleUnload}
        />
      )}

      {/* Cloud ASR config modal */}
      {configuringDef && (
        <ProviderConfigModal
          open={Boolean(configuringAsr)}
          onClose={() => setConfiguringAsr(null)}
          logoSrc={configuringDef.logoSrc}
          providerKey={configuringDef.providerKey}
          providerName={t(`asr.${configuringDef.providerKey}`)}
          fields={configuringDef.fields}
          presetModelsByType={{}}
          supportedTypes={[]}
          config={{ enabled: true, ...getCloudValues(configuringDef.providerKey) }}
          onSave={handleCloudSave}
        />
      )}
    </div>
  );
}
