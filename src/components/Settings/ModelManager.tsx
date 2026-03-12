import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Download, Loader2, Settings as SettingsIcon, CheckCircle2, FolderOpen, XCircle, Plus, Users } from "lucide-react";
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
import { invoke } from "@tauri-apps/api/core";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import {
  useEngineStore,
  ENGINE_KEYS,
  CLOUD_ENGINES,
  FALLBACK_MODEL_SIZES,
  isEngineAvailable,
  isCloudEngineConfigured,
} from "../../stores/engineStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { ProviderCard } from "./ProviderCard";
import { ProviderConfigModal } from "./ProviderConfigModal";
import { CustomModelDialog } from "./CustomModelDialog";
import * as api from "../../services/asrClient";

const ASR_LANGUAGE_KEYS = ["auto", "zh", "en", "ja", "ko", "de", "fr", "es"] as const;

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

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes.toFixed(2)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

// Vendor card config modal for downloading models
function VendorConfigModal({
  open,
  onClose,
  vendor,
  downloadedModels,
  loadedModels,
  downloadState,
  onDownload,
  onCancelDownload,
  onRevealFolder,
}: {
  open: boolean;
  onClose: () => void;
  vendor: VendorDef;
  downloadedModels: Set<string>;
  loadedModels: Set<string>;
  downloadState: { phase: string; modelSize: string; elapsedSeconds: number; downloadedBytes: number; totalBytes: number; error: string | null; modelName: string | null } | null;
  onDownload: (engine: string, size: string) => void;
  onCancelDownload: (engine: string) => void;
  onRevealFolder: (engine: string, size: string) => void;
}) {
  const { t } = useTranslation("settings");
  const isEngineDownloading = downloadState && downloadState.phase === "downloading";

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
            const isDownloaded = downloadedModels.has(key);
            const isLoaded = loadedModels.has(key);
            const isThisModelDownloading = isEngineDownloading && downloadState?.modelSize === model.size;

            return (
              <div
                key={key}
                className="rounded-lg border border-border p-3"
              >
                <div className="flex items-center justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{model.size}</span>
                      {isLoaded && (
                        <Badge variant="outline" className="border-green-300 text-green-600">
                          {t("common:status.loaded")}
                        </Badge>
                      )}
                      {isDownloaded && !isLoaded && (
                        <Badge variant="outline" className="border-blue-300 text-blue-600">
                          {t("common:downloadPhase.completed")}
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
                  <div className="flex items-center gap-1.5">
                    {(isLoaded || isDownloaded) && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 w-8 p-0"
                        title={t("common:action.openFolder")}
                        onClick={() => onRevealFolder(vendor.engine, model.size)}
                      >
                        <FolderOpen className="h-3.5 w-3.5" />
                      </Button>
                    )}
                    {!isDownloaded && (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={!!isThisModelDownloading}
                        onClick={() => onDownload(vendor.engine, model.size)}
                      >
                        {isThisModelDownloading ? (
                          <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Download className="mr-1.5 h-3.5 w-3.5" />
                        )}
                        {downloadState?.phase === "error" && downloadState.modelSize === model.size
                          ? t("common:action.retry")
                          : t("common:action.download")}
                      </Button>
                    )}
                  </div>
                </div>
                {/* Download progress */}
                {isThisModelDownloading && downloadState && (
                  <div className="mt-2 space-y-1">
                    <div className="flex items-center gap-2 text-xs text-blue-600">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      <span>
                        {t("common:downloadPhase.downloading")}
                        {downloadState.elapsedSeconds > 0 && downloadState.downloadedBytes > 0 && (
                          <span className="ml-1 font-medium">
                            {formatBytes(downloadState.downloadedBytes / downloadState.elapsedSeconds)}/s
                          </span>
                        )}
                      </span>
                      <span className="text-muted-foreground">
                        {formatElapsed(downloadState.elapsedSeconds)}
                      </span>
                      {downloadState.totalBytes > 0 && (
                        <span className="ml-auto text-muted-foreground">
                          {formatBytes(downloadState.downloadedBytes)} / {formatBytes(downloadState.totalBytes)}
                          {" "}({Math.min(100, Math.round((downloadState.downloadedBytes / downloadState.totalBytes) * 100))}%)
                        </span>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        className="ml-1 h-5 w-5 p-0 text-muted-foreground hover:text-destructive"
                        title={t("common:action.cancel")}
                        onClick={() => onCancelDownload(vendor.engine)}
                      >
                        <XCircle className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                    {downloadState.totalBytes > 0 && (
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-blue-100 dark:bg-blue-900/30">
                        <div
                          className="h-full rounded-full bg-blue-500 transition-all duration-500"
                          style={{
                            width: `${Math.min(100, Math.round((downloadState.downloadedBytes / downloadState.totalBytes) * 100))}%`,
                          }}
                        />
                      </div>
                    )}
                  </div>
                )}
                {/* Download error */}
                {downloadState?.phase === "error" && downloadState.modelSize === model.size && (
                  <div className="mt-2 text-xs text-destructive">
                    {downloadState.error}
                  </div>
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
  const {
    engines,
    fetchEngines,
    loadingStates,
    downloadStates,
    startModelDownload,
    cancelModelDownload,
    clearLoadingState,
    clearDownloadState,
    selectedEngine,
    selectedModelSize,
    selectedLanguage,
    setSelectedEngine,
    setSelectedModelSize,
    setSelectedLanguage,
  } = useEngineStore();
  const { general, cloudAsr, setCloudAsr, autoDegradation, setAutoDegradation } =
    useSettingsStore();

  // Compute available model sizes for current engine
  const currentEngineInfo = engines.find((e) => e.name === selectedEngine);
  const modelSizes = currentEngineInfo?.model_sizes?.length
    ? currentEngineInfo.model_sizes
    : FALLBACK_MODEL_SIZES[selectedEngine] || [];
  const downloadedModelsSet = new Set(currentEngineInfo?.downloaded_models ?? []);
  const isCloud = CLOUD_ENGINES.has(selectedEngine);
  const [configuringVendor, setConfiguringVendor] = useState<string | null>(null);
  const [configuringAsr, setConfiguringAsr] = useState<string | null>(null);
  const [showCustomDialog, setShowCustomDialog] = useState(false);

  // Pyannote diarization model state
  const [pyannoteStatus, setPyannoteStatus] = useState<api.PyannoteStatus | null>(null);
  const pyannotePollingRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchPyannoteStatus = useCallback(async () => {
    try {
      const status = await api.getPyannoteStatus();
      setPyannoteStatus(status);
      return status;
    } catch {
      return null;
    }
  }, []);

  // Initial pyannote status check
  useEffect(() => {
    fetchPyannoteStatus();
    return () => {
      if (pyannotePollingRef.current) clearTimeout(pyannotePollingRef.current);
    };
  }, [fetchPyannoteStatus]);

  const handlePyannoteDownload = async () => {
    try {
      await api.downloadPyannote();
      // Start polling
      const poll = async () => {
        const status = await fetchPyannoteStatus();
        if (status && status.phase === "downloading") {
          pyannotePollingRef.current = setTimeout(poll, 1000);
        } else if (status?.phase === "completed") {
          toast.success(t("asr.pyannoteDownloadSuccess"));
        } else if (status?.phase === "error") {
          toast.error(t("asr.pyannoteDownloadFailed", { error: status.error ?? "" }));
        }
      };
      pyannotePollingRef.current = setTimeout(poll, 1000);
    } catch (err) {
      toast.error(String(err));
    }
  };

  const handlePyannoteCancelDownload = async () => {
    if (pyannotePollingRef.current) {
      clearTimeout(pyannotePollingRef.current);
      pyannotePollingRef.current = null;
    }
    try {
      await api.cancelPyannoteDownload();
      await fetchPyannoteStatus();
    } catch {
      // Best effort
    }
  };

  useEffect(() => {
    fetchEngines();
  }, [fetchEngines]);

  // Track which engines have already been toasted to prevent duplicates
  const loadNotifiedRef = useRef<Set<string>>(new Set());
  const downloadNotifiedRef = useRef<Set<string>>(new Set());

  // Watch loading states for toast notifications
  useEffect(() => {
    for (const [engineName, state] of Object.entries(loadingStates)) {
      if (loadNotifiedRef.current.has(engineName)) continue;
      if (state.phase === "ready") {
        loadNotifiedRef.current.add(engineName);
        toast.success(t("asr.loadSuccess", { model: state.modelSize }));
        clearLoadingState(engineName);
      } else if (state.phase === "error") {
        loadNotifiedRef.current.add(engineName);
        toast.error(t("asr.loadFailed", { error: state.error ?? "" }));
      }
    }
    for (const key of loadNotifiedRef.current) {
      if (!loadingStates[key]) loadNotifiedRef.current.delete(key);
    }
  }, [loadingStates, t, clearLoadingState]);

  // Watch download states for toast notifications
  useEffect(() => {
    for (const [engineName, state] of Object.entries(downloadStates)) {
      if (downloadNotifiedRef.current.has(engineName)) continue;
      if (state.phase === "completed") {
        downloadNotifiedRef.current.add(engineName);
        toast.success(t("asr.downloadSuccess", { model: state.modelSize }));
        clearDownloadState(engineName);
      } else if (state.phase === "error") {
        downloadNotifiedRef.current.add(engineName);
        toast.error(t("asr.downloadFailed", { error: state.error ?? "" }));
      }
    }
    for (const key of downloadNotifiedRef.current) {
      if (!downloadStates[key]) downloadNotifiedRef.current.delete(key);
    }
  }, [downloadStates, t, clearDownloadState]);

  const downloadedModels = useMemo(
    () =>
      new Set(
        engines.flatMap((e) =>
          (e.downloaded_models ?? []).map((m) => `${e.name}:${m}`)
        )
      ),
    [engines]
  );

  const loadedModels = useMemo(
    () =>
      new Set(
        engines
          .filter((e) => e.is_loaded && e.current_model_size)
          .map((e) => `${e.name}:${e.current_model_size}`)
      ),
    [engines]
  );

  const handleDownload = (engine: string, size: string) => {
    startModelDownload(engine, size);
  };

  const handleCancelDownload = async (engine: string) => {
    await cancelModelDownload(engine);
    toast.info(t("asr.downloadCancelled"));
  };

  const handleRevealFolder = async (engine: string, size: string) => {
    try {
      const resp = await api.getModelPath(engine, size);
      if (resp.path) {
        await invoke("reveal_file", { path: resp.path });
      } else {
        toast.error(t("common:error.modelPathNotFound"));
      }
    } catch (err) {
      toast.error(String(err));
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

  // Get downloaded count for a vendor
  const getDownloadedCount = (engine: string): number => {
    const e = engines.find((eng) => eng.name === engine);
    return e?.downloaded_models?.length ?? 0;
  };

  return (
    <div className="space-y-6 py-2">
      <div>
        <h3 className="text-lg font-semibold">{t("asr.title")}</h3>
        <p className="text-sm text-muted-foreground">{t("asr.subtitle")}</p>
      </div>

      {/* ASR Recognition Language */}
      <div className="space-y-2">
        <label className="text-sm font-medium">
          {t("asr.asrLanguage")}
        </label>
        <p className="text-xs text-muted-foreground">
          {t("asr.asrLanguageDesc")}
        </p>
        <Select value={selectedLanguage} onValueChange={setSelectedLanguage}>
          <SelectTrigger className="w-[200px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ASR_LANGUAGE_KEYS.map((key) => (
              <SelectItem key={key} value={key}>
                {t(`common:language.${key}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* ASR Engine */}
      <div className="space-y-2">
        <label className="text-sm font-medium">
          {t("asr.asrEngine")}
        </label>
        <p className="text-xs text-muted-foreground">
          {t("asr.asrEngineDesc")}
        </p>
        <Select value={selectedEngine} onValueChange={setSelectedEngine}>
          <SelectTrigger className="w-[280px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ENGINE_KEYS.map((key) => {
              const available = isEngineAvailable(key, engines, cloudAsr);
              return (
                <SelectItem key={key} value={key} disabled={!available}>
                  <div className="flex items-center gap-2">
                    <span className={available ? "" : "text-muted-foreground"}>
                      {t(`common:engine.${key}`)}
                    </span>
                    {!CLOUD_ENGINES.has(key) && engines.find((e) => e.name === key)?.is_loaded && (
                      <Badge variant="secondary" className="text-[10px] px-1 py-0">
                        {t("common:status.loaded")}
                      </Badge>
                    )}
                    {CLOUD_ENGINES.has(key) && isCloudEngineConfigured(key, cloudAsr) && (
                      <Badge variant="outline" className="text-[10px] px-1 py-0 border-green-300 text-green-600">
                        {t("common:status.apiReady")}
                      </Badge>
                    )}
                  </div>
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>
      </div>

      {/* ASR Model Size */}
      <div className="space-y-2">
        <label className="text-sm font-medium">
          {t("asr.asrModelSize")}
        </label>
        <p className="text-xs text-muted-foreground">
          {t("asr.asrModelSizeDesc")}
        </p>
        <Select
          value={selectedModelSize}
          onValueChange={setSelectedModelSize}
          disabled={modelSizes.length === 0}
        >
          <SelectTrigger className="w-[280px]">
            <SelectValue placeholder={modelSizes.length === 0 ? t("asr.noModelAvailable") : undefined} />
          </SelectTrigger>
          <SelectContent>
            {modelSizes.map((size) => {
              const sizeAvailable =
                isCloud ||
                downloadedModelsSet.has(size) ||
                (currentEngineInfo?.is_loaded && currentEngineInfo.current_model_size === size);
              return (
                <SelectItem key={size} value={size} disabled={!sizeAvailable}>
                  <div className="flex items-center gap-2">
                    <span className={sizeAvailable ? "" : "text-muted-foreground"}>
                      {size}
                    </span>
                    {currentEngineInfo?.is_loaded && currentEngineInfo.current_model_size === size && (
                      <Badge variant="secondary" className="text-[10px] px-1 py-0">
                        {t("common:status.loaded")}
                      </Badge>
                    )}
                    {downloadedModelsSet.has(size) &&
                      !(currentEngineInfo?.is_loaded && currentEngineInfo.current_model_size === size) && (
                        <Badge variant="outline" className="text-[10px] px-1 py-0 border-blue-300 text-blue-600">
                          {t("common:downloadPhase.completed")}
                        </Badge>
                      )}
                  </div>
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>
      </div>

      {/* Local ASR vendor cards */}
      <div className="grid gap-2">
        {VENDOR_DEFS.map((vendor) => {
          const loadedSize = getVendorStatus(vendor.engine);
          const downloadedCount = getDownloadedCount(vendor.engine);
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
                  {downloadedCount > 0 && (
                    <Badge variant="outline" className="gap-1 border-blue-300 text-[10px] text-blue-600">
                      <CheckCircle2 className="h-2.5 w-2.5" />
                      {downloadedCount}
                    </Badge>
                  )}
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

      {/* Custom model card */}
      <div className="grid gap-2">
        <div
          className="flex cursor-pointer items-center gap-3 rounded-lg border border-dashed border-border p-3 transition-colors hover:bg-accent/50"
          onClick={() => setShowCustomDialog(true)}
        >
          <div
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg"
            style={{ backgroundColor: "#7C3AED10" }}
          >
            <Plus className="h-5 w-5 text-purple-600" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="font-medium">
                {t("asr.custom.cardTitle")}
              </span>
              <Badge variant="secondary" className="gap-1 text-[10px]">
                {t("llm.local")}
              </Badge>
              {(general.customASRModels?.length ?? 0) > 0 && (
                <Badge variant="outline" className="gap-1 border-blue-300 text-[10px] text-blue-600">
                  <CheckCircle2 className="h-2.5 w-2.5" />
                  {general.customASRModels.length}
                </Badge>
              )}
            </div>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              {t("asr.custom.cardDesc")}
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              setShowCustomDialog(true);
            }}
          >
            <SettingsIcon className="mr-1.5 h-3.5 w-3.5" />
            {t("llm.configureBtn")}
          </Button>
        </div>
      </div>

      {/* Post-processing models */}
      <div className="space-y-3 border-t pt-4">
        <div>
          <h4 className="text-base font-semibold">{t("asr.postProcessTitle")}</h4>
          <p className="text-sm text-muted-foreground">
            {t("asr.postProcessSubtitle")}
          </p>
        </div>

        <div className="grid gap-2">
          {/* Pyannote diarization model */}
          <div className="flex items-center gap-3 rounded-lg border border-border p-3">
            <div
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg"
              style={{ backgroundColor: "#6366F110" }}
            >
              <Users className="h-5 w-5 text-indigo-600" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="font-medium">pyannote</span>
                <Badge variant="secondary" className="gap-1 text-[10px]">
                  {t("asr.diarization")}
                </Badge>
                {pyannoteStatus?.downloaded && (
                  <Badge variant="outline" className="gap-1 border-green-300 text-[10px] text-green-600">
                    <CheckCircle2 className="h-2.5 w-2.5" />
                    {t("common:downloadPhase.completed")}
                  </Badge>
                )}
              </div>
              <p className="mt-0.5 truncate text-xs text-muted-foreground">
                {t("asr.pyannoteDesc")}
              </p>
            </div>
            <div className="flex items-center gap-1.5">
              {pyannoteStatus?.downloaded && pyannoteStatus.path && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 w-8 p-0"
                  title={t("common:action.openFolder")}
                  onClick={() => {
                    invoke("reveal_file", { path: pyannoteStatus.path }).catch(() => {});
                  }}
                >
                  <FolderOpen className="h-3.5 w-3.5" />
                </Button>
              )}
              {pyannoteStatus?.downloaded ? (
                <Badge variant="outline" className="border-green-300 text-green-600">
                  <CheckCircle2 className="mr-1 h-3 w-3" />
                  {t("common:downloadPhase.completed")}
                </Badge>
              ) : pyannoteStatus?.phase === "downloading" ? (
                <Button variant="outline" size="sm" disabled>
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  {t("common:downloadPhase.downloading")}
                </Button>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handlePyannoteDownload}
                >
                  <Download className="mr-1.5 h-3.5 w-3.5" />
                  {pyannoteStatus?.phase === "error"
                    ? t("common:action.retry")
                    : t("common:action.download")}
                </Button>
              )}
            </div>
          </div>
          {/* Download progress */}
          {pyannoteStatus?.phase === "downloading" && (
            <div className="ml-13 space-y-1 px-3">
              <div className="flex items-center gap-2 text-xs text-blue-600">
                <Loader2 className="h-3 w-3 animate-spin" />
                <span>
                  {t("common:downloadPhase.downloading")}
                  {pyannoteStatus.elapsed_seconds > 0 && pyannoteStatus.downloaded_bytes > 0 && (
                    <span className="ml-1 font-medium">
                      {formatBytes(pyannoteStatus.downloaded_bytes / pyannoteStatus.elapsed_seconds)}/s
                    </span>
                  )}
                </span>
                <span className="text-muted-foreground">
                  {formatElapsed(pyannoteStatus.elapsed_seconds)}
                </span>
                {pyannoteStatus.total_bytes > 0 && (
                  <span className="ml-auto text-muted-foreground">
                    {formatBytes(pyannoteStatus.downloaded_bytes)} / {formatBytes(pyannoteStatus.total_bytes)}
                    {" "}({Math.min(100, Math.round((pyannoteStatus.downloaded_bytes / pyannoteStatus.total_bytes) * 100))}%)
                  </span>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  className="ml-1 h-5 w-5 p-0 text-muted-foreground hover:text-destructive"
                  onClick={handlePyannoteCancelDownload}
                >
                  <XCircle className="h-3.5 w-3.5" />
                </Button>
              </div>
              {pyannoteStatus.total_bytes > 0 && (
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-blue-100 dark:bg-blue-900/30">
                  <div
                    className="h-full rounded-full bg-blue-500 transition-all duration-500"
                    style={{
                      width: `${Math.min(100, Math.round((pyannoteStatus.downloaded_bytes / pyannoteStatus.total_bytes) * 100))}%`,
                    }}
                  />
                </div>
              )}
            </div>
          )}
          {/* Download error */}
          {pyannoteStatus?.phase === "error" && (
            <div className="px-3 text-xs text-destructive">
              {pyannoteStatus.error}
            </div>
          )}
        </div>
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
          downloadedModels={downloadedModels}
          loadedModels={loadedModels}
          downloadState={downloadStates[configuringVendorDef.engine] ?? null}
          onDownload={handleDownload}
          onCancelDownload={handleCancelDownload}
          onRevealFolder={handleRevealFolder}
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

      {/* Custom model dialog */}
      <CustomModelDialog
        open={showCustomDialog}
        onClose={() => setShowCustomDialog(false)}
      />
    </div>
  );
}
