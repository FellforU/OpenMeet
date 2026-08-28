import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Download,
  Loader2,
  CheckCircle2,
  FolderOpen,
  XCircle,
  HardDrive,
} from "lucide-react";
import { toast } from "sonner";
import { invoke } from "@tauri-apps/api/core";
import { Switch } from "../ui/switch";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";
import { Progress } from "../ui/progress";
import { SystemModelSelector } from "./SystemModelSelector";
import type { ExtraModelGroup } from "./SystemModelSelector";
import { LLM_PROVIDERS } from "./LLMProviderTab";
import { useSettingsStore } from "../../stores/settingsStore";
import * as api from "../../services/asrClient";
import type { EmbeddingModelInfo, EmbeddingDownloadStatus } from "../../services/asrClient";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function KnowledgeSettings() {
  const { t, i18n } = useTranslation("settings");
  const { general, setGeneral } = useSettingsStore();
  const isZh = i18n.language === "zh";

  const hasRerankProviders = LLM_PROVIDERS.some((p) =>
    p.supportedTypes.includes("RERANK")
  );

  // Local embedding models state
  const [models, setModels] = useState<EmbeddingModelInfo[]>([]);
  const [downloadStates, setDownloadStates] = useState<Record<string, EmbeddingDownloadStatus>>({});
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Fetch available models
  const fetchModels = useCallback(async () => {
    try {
      const list = await api.listEmbeddingModels();
      setModels(list);
    } catch {
      // ASR service may not be running yet
    }
  }, []);

  useEffect(() => {
    fetchModels();
  }, [fetchModels]);

  // Poll download progress for active downloads
  const activeDownloads = useMemo(
    () => Object.entries(downloadStates).filter(([, s]) => s.phase === "downloading").map(([k]) => k),
    [downloadStates]
  );

  useEffect(() => {
    if (activeDownloads.length === 0) {
      if (pollRef.current !== null) clearInterval(pollRef.current);
      return;
    }
    const id = setInterval(async () => {
      for (const key of activeDownloads) {
        try {
          const status = await api.getEmbeddingDownloadStatus(key);
          if (status.phase === "completed") {
            toast.success(t("knowledge.downloadSuccess", { model: key }));
            fetchModels();
            // Remove from download states to stop polling
            setDownloadStates((prev) => {
              const next = { ...prev };
              delete next[key];
              return next;
            });
          } else if (status.phase === "error") {
            toast.error(t("knowledge.downloadFailed", { error: status.error }));
            setDownloadStates((prev) => {
              const next = { ...prev };
              delete next[key];
              return next;
            });
          } else {
            setDownloadStates((prev) => ({ ...prev, [key]: status }));
          }
        } catch {
          // ignore polling errors
        }
      }
    }, 1500);
    pollRef.current = id;
    return () => clearInterval(id);
  }, [activeDownloads, fetchModels, t]);

  const handleDownload = useCallback(async (key: string) => {
    try {
      await api.downloadEmbeddingModel(key);
      const model = models.find((m) => m.key === key);
      setDownloadStates((prev) => ({
        ...prev,
        [key]: {
          key,
          phase: "downloading",
          elapsed_seconds: 0,
          downloaded_bytes: 0,
          total_bytes: model?.size_bytes ?? 0,
          error: null,
        },
      }));
    } catch (e: unknown) {
      toast.error(String(e));
    }
  }, [models]);

  const handleCancelDownload = useCallback(async (key: string) => {
    try {
      await api.cancelEmbeddingDownload(key);
      setDownloadStates((prev) => ({
        ...prev,
        [key]: { key, phase: "idle", elapsed_seconds: 0, downloaded_bytes: 0, total_bytes: 0, error: null },
      }));
      toast.info(t("asr.downloadCancelled"));
    } catch (e: unknown) {
      toast.error(String(e));
    }
  }, [t]);

  const handleSetDefault = useCallback(
    (repoId: string) => {
      setGeneral({ defaultEmbeddingModel: `local/${repoId}` });
      toast.success(t("knowledge.setAsDefaultSuccess"));
    },
    [setGeneral, t]
  );

  // Build extra groups for SystemModelSelector (downloaded local models)
  const localModelGroups: ExtraModelGroup[] = useMemo(() => {
    const downloadedModels = models.filter((m) => m.downloaded);
    if (downloadedModels.length === 0) return [];
    return [
      {
        providerKey: "local",
        providerName: t("knowledge.localModels"),
        logoSrc: "",
        models: downloadedModels.map((m) => ({
          providerKey: "local",
          providerName: t("knowledge.localModels"),
          logoSrc: "",
          modelId: m.name,
          ref: `local/${m.repo_id}`,
        })),
      },
    ];
  }, [models, t]);

  const isCurrentDefault = (repoId: string) =>
    general.defaultEmbeddingModel === `local/${repoId}`;

  return (
    <div className="space-y-6 py-2">
      <div>
        <h3 className="text-base font-medium">{t("knowledge.title")}</h3>
        <p className="text-xs text-muted-foreground">
          {t("knowledge.subtitle")}
        </p>
      </div>

      {/* Local Embedding Models */}
      <div className="space-y-3">
        <div>
          <label className="text-sm font-medium flex items-center gap-1.5">
            <HardDrive className="h-4 w-4" />
            {t("knowledge.localTitle")}
          </label>
          <p className="text-xs text-muted-foreground">
            {t("knowledge.localSubtitle")}
          </p>
        </div>

        <div className="space-y-2">
          {models.map((model) => {
            const ds = downloadStates[model.key];
            const isDownloading = ds?.phase === "downloading";
            const isDownloaded = model.downloaded || ds?.phase === "completed";
            const isError = ds?.phase === "error";
            const isActive = isCurrentDefault(model.repo_id);
            const desc = isZh ? model.description_zh : model.description_en;
            const progress =
              isDownloading && ds.total_bytes > 0
                ? Math.round((ds.downloaded_bytes / ds.total_bytes) * 100)
                : 0;

            return (
              <div
                key={model.key}
                className={`rounded-lg border p-3 transition-colors ${
                  isActive
                    ? "border-primary bg-primary/5"
                    : "border-border"
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{model.name}</span>
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                        {model.params}
                      </Badge>
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                        {model.dimension}d
                      </Badge>
                      {model.vram_gb > 0 && (
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                          ~{model.vram_gb}GB VRAM
                        </Badge>
                      )}
                      {isDownloaded && (
                        <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
                      )}
                      {isActive && (
                        <Badge variant="default" className="text-[10px] px-1.5 py-0">
                          {t("knowledge.inUse")}
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {desc}
                    </p>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    {/* Open folder button */}
                    {isDownloaded && model.path && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0"
                        onClick={() =>
                          invoke("reveal_file", { path: model.path }).catch(() => {})
                        }
                      >
                        <FolderOpen className="h-3.5 w-3.5" />
                      </Button>
                    )}

                    {/* Set as default button */}
                    {isDownloaded && !isActive && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs"
                        onClick={() => handleSetDefault(model.repo_id)}
                      >
                        {t("knowledge.setAsDefault")}
                      </Button>
                    )}

                    {/* Download button */}
                    {!isDownloaded && !isDownloading && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs"
                        onClick={() => handleDownload(model.key)}
                      >
                        <Download className="h-3.5 w-3.5 mr-1" />
                        {formatBytes(model.size_bytes)}
                      </Button>
                    )}

                    {/* Cancel download button */}
                    {isDownloading && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0"
                        onClick={() => handleCancelDownload(model.key)}
                      >
                        <XCircle className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                </div>

                {/* Download progress */}
                {isDownloading && ds && (
                  <div className="mt-2 space-y-1">
                    <Progress value={progress} className="h-1.5" />
                    <div className="flex justify-between text-[10px] text-muted-foreground">
                      <span>
                        {formatBytes(ds.downloaded_bytes)} / {formatBytes(ds.total_bytes)}
                      </span>
                      <span>{progress}%</span>
                    </div>
                  </div>
                )}

                {/* Error state */}
                {isError && ds?.error && (
                  <p className="mt-1 text-xs text-destructive">{ds.error}</p>
                )}
              </div>
            );
          })}

          {models.length === 0 && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              {t("asr.loading")}
            </div>
          )}
        </div>
      </div>

      {/* Default Embedding Model (combined local + cloud) */}
      <div className="space-y-2">
        <label className="text-sm font-medium">
          {t("general.defaultEmbeddingModel")}
        </label>
        <p className="text-xs text-muted-foreground">
          {t("general.defaultEmbeddingModelDesc")}
        </p>
        <SystemModelSelector
          value={general.defaultEmbeddingModel}
          onChange={(v) => setGeneral({ defaultEmbeddingModel: v })}
          modelType="EMBEDDING"
          extraGroups={localModelGroups}
        />
      </div>

      {/* Enable Rerank toggle */}
      {hasRerankProviders && (
        <>
          <div className="flex items-center justify-between">
            <div>
              <label className="text-sm font-medium">
                {t("knowledge.enableRerank")}
              </label>
              <p className="text-xs text-muted-foreground">
                {t("knowledge.enableRerankDesc")}
              </p>
            </div>
            <Switch
              checked={general.enableRerank}
              onCheckedChange={(v) => setGeneral({ enableRerank: v })}
            />
          </div>

          {/* Default Rerank Model (shown only when rerank is enabled) */}
          {general.enableRerank && (
            <div className="space-y-2">
              <label className="text-sm font-medium">
                {t("general.defaultRerankModel")}
              </label>
              <p className="text-xs text-muted-foreground">
                {t("general.defaultRerankModelDesc")}
              </p>
              <SystemModelSelector
                value={general.defaultRerankModel}
                onChange={(v) => setGeneral({ defaultRerankModel: v })}
                modelType="RERANK"
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}
