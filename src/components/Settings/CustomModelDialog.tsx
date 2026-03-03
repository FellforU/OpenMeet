import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Download,
  Trash2,
  Loader2,
  Play,
  CheckCircle2,
  Plus,
  Search,
  XCircle,
  FolderOpen,
} from "lucide-react";
import { toast } from "sonner";
import { invoke } from "@tauri-apps/api/core";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";
import { Input } from "../ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import { useSettingsStore, type CustomASRModel } from "../../stores/settingsStore";
import { useEngineStore } from "../../stores/engineStore";
import * as api from "../../services/asrClient";

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

interface AddFormState {
  platform: "huggingface" | "modelscope";
  modelId: string;
  mirrorUrl: string;
  vramGb: number;
  validating: boolean;
  validated: boolean;
  validatedName: string;
  error: string;
}

const initialAddForm: AddFormState = {
  platform: "huggingface",
  modelId: "",
  mirrorUrl: "",
  vramGb: 2,
  validating: false,
  validated: false,
  validatedName: "",
  error: "",
};

export function CustomModelDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation("settings");
  const { general, setGeneral } = useSettingsStore();
  const {
    engines,
    loadingStates,
    downloadStates,
    startModelLoad,
    cancelModelLoad,
    startModelDownload,
    cancelModelDownload,
    fetchEngines,
  } = useEngineStore();
  const [showAddForm, setShowAddForm] = useState(false);
  const [unloadingKey, setUnloadingKey] = useState<string | null>(null);

  // Compute default HF mirror URL from system settings
  const defaultHfMirror =
    general.enableHfMirror && general.hfMirror
      ? general.hfMirror
      : "https://huggingface.co";

  const [form, setForm] = useState<AddFormState>({
    ...initialAddForm,
    mirrorUrl: defaultHfMirror,
  });

  const customModels = general.customASRModels ?? [];

  const customEngine = engines.find((e) => e.name === "custom");
  const downloadedModels = new Set(
    (customEngine?.downloaded_models ?? []).map((m) => `custom:${m}`)
  );
  const loadedModel = customEngine?.is_loaded
    ? `custom:${customEngine.current_model_size}`
    : null;
  const loadingState = loadingStates.custom ?? null;
  const downloadState = downloadStates.custom ?? null;
  const isEngineLoading = loadingState && (loadingState.phase === "preparing" || loadingState.phase === "loading");
  const isEngineDownloading = downloadState && downloadState.phase === "downloading";

  const handleValidate = async () => {
    if (!form.modelId.trim()) return;
    setForm((f) => ({ ...f, validating: true, error: "", validated: false }));
    try {
      const resp = await api.validateCustomModel({
        platform: form.platform,
        model_id: form.modelId.trim(),
        mirror_url: form.mirrorUrl.trim() || null,
      });
      if (resp.valid) {
        setForm((f) => ({
          ...f,
          validating: false,
          validated: true,
          validatedName: resp.model_name ?? f.modelId,
        }));
      } else {
        setForm((f) => ({
          ...f,
          validating: false,
          error: resp.error ?? t("asr.custom.validateFailed"),
        }));
      }
    } catch (err) {
      setForm((f) => ({
        ...f,
        validating: false,
        error: String(err),
      }));
    }
  };

  const handleAddModel = async () => {
    if (!form.validated) return;

    const id = crypto.randomUUID().slice(0, 8);
    const newModel: CustomASRModel = {
      id,
      name: form.validatedName || form.modelId,
      platform: form.platform,
      modelId: form.modelId.trim(),
      mirrorUrl: form.mirrorUrl.trim(),
      vramGb: form.vramGb,
    };

    const updated = [...customModels, newModel];
    await setGeneral({ customASRModels: updated });
    await pushModelsToBackend(updated);
    setForm({ ...initialAddForm, mirrorUrl: defaultHfMirror });
    setShowAddForm(false);
    toast.success(t("asr.custom.addSuccess"));
  };

  const handleRemoveModel = async (id: string) => {
    const updated = customModels.filter((m) => m.id !== id);
    await setGeneral({ customASRModels: updated });
    await pushModelsToBackend(updated);
    await fetchEngines();
  };

  const handleDownload = (modelId: string) => {
    startModelDownload("custom", modelId);
  };

  const handleLoad = (modelId: string) => {
    startModelLoad("custom", modelId);
  };

  const handleUnload = async () => {
    setUnloadingKey("custom:unload");
    try {
      await api.unloadEngineModel("custom");
      await fetchEngines();
    } catch (err) {
      toast.error(String(err));
    } finally {
      setUnloadingKey(null);
    }
  };

  const handleRevealFolder = async (modelId: string) => {
    try {
      const resp = await api.getModelPath("custom", modelId);
      if (resp.path) {
        await invoke("reveal_file", { path: resp.path });
      } else {
        toast.error(t("common:error.modelPathNotFound"));
      }
    } catch (err) {
      toast.error(String(err));
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-6 w-6 items-center justify-center rounded bg-purple-100 text-purple-600 dark:bg-purple-900/30">
              <Plus className="h-4 w-4" />
            </div>
            <DialogTitle>{t("asr.custom.title")}</DialogTitle>
          </div>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          {t("asr.custom.subtitle")}
        </p>

        {/* Model list */}
        <div className="mt-2 space-y-2">
          {customModels.length === 0 && !showAddForm && (
            <p className="py-4 text-center text-sm text-muted-foreground">
              {t("asr.custom.empty")}
            </p>
          )}
          {customModels.map((model) => {
            const key = `custom:${model.id}`;
            const isDownloaded = downloadedModels.has(key);
            const isLoaded = loadedModel === key;
            const isThisModelLoading = isEngineLoading && loadingState?.modelSize === model.id;
            const isThisModelDownloading = isEngineDownloading && downloadState?.modelSize === model.id;
            const isUnloading = unloadingKey === "custom:unload";
            const isThisModelBusy = isThisModelLoading || isThisModelDownloading || isUnloading;

            return (
              <div key={model.id} className="rounded-lg border border-border p-3">
                <div className="flex items-center justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{model.name}</span>
                      <Badge variant="outline" className="text-[10px]">
                        {model.platform === "huggingface" ? "HF" : "MS"}
                      </Badge>
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
                      <span className="truncate">{model.modelId}</span>
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
                        onClick={() => handleRevealFolder(model.id)}
                      >
                        <FolderOpen className="h-3.5 w-3.5" />
                      </Button>
                    )}
                    {isLoaded ? (
                      <Button
                        variant="destructive"
                        size="sm"
                        disabled={isThisModelBusy}
                        onClick={handleUnload}
                      >
                        {isUnloading ? (
                          <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                        )}
                        {t("common:action.unload")}
                      </Button>
                    ) : isDownloaded ? (
                      <Button
                        variant="default"
                        size="sm"
                        disabled={isThisModelBusy}
                        onClick={() => handleLoad(model.id)}
                      >
                        {isThisModelLoading ? (
                          <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Play className="mr-1.5 h-3.5 w-3.5" />
                        )}
                        {t("settings:asr.activate")}
                      </Button>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={isThisModelBusy}
                        onClick={() => handleDownload(model.id)}
                      >
                        {isThisModelDownloading ? (
                          <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Download className="mr-1.5 h-3.5 w-3.5" />
                        )}
                        {downloadState?.phase === "error" && downloadState.modelSize === model.id
                          ? t("common:action.retry")
                          : t("common:action.download")}
                      </Button>
                    )}
                    {!isLoaded && !isThisModelBusy && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
                        onClick={() => handleRemoveModel(model.id)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
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
                        onClick={() => cancelModelDownload("custom")}
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
                {/* Loading progress */}
                {isThisModelLoading && loadingState && (
                  <div className="mt-2 flex items-center gap-2 text-xs text-blue-600">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    <span>{t(`common:loadPhase.${loadingState.phase}`)}</span>
                    <span className="text-muted-foreground">
                      {formatElapsed(loadingState.elapsedSeconds)}
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="ml-1 h-5 w-5 p-0 text-muted-foreground hover:text-destructive"
                      title={t("common:action.cancel")}
                      onClick={() => cancelModelLoad("custom")}
                    >
                      <XCircle className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                )}
                {/* Download error */}
                {downloadState?.phase === "error" && downloadState.modelSize === model.id && (
                  <div className="mt-2 text-xs text-destructive">{downloadState.error}</div>
                )}
                {/* Load error */}
                {loadingState?.phase === "error" && loadingState.modelSize === model.id && (
                  <div className="mt-2 text-xs text-destructive">{loadingState.error}</div>
                )}
              </div>
            );
          })}
        </div>

        {/* Add model form */}
        {showAddForm ? (
          <div className="mt-3 space-y-3 rounded-lg border border-dashed border-border p-3">
            <div className="flex items-center gap-2">
              <label className="w-20 shrink-0 text-sm font-medium">
                {t("asr.custom.platform")}
              </label>
              <Select
                value={form.platform}
                onValueChange={(v) => {
                  const platform = v as "huggingface" | "modelscope";
                  setForm((f) => ({
                    ...f,
                    platform,
                    mirrorUrl: platform === "huggingface" ? defaultHfMirror : "",
                    validated: false,
                    error: "",
                  }));
                }}
              >
                <SelectTrigger className="flex-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="huggingface">HuggingFace</SelectItem>
                  <SelectItem value="modelscope">ModelScope</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center gap-2">
              <label className="w-20 shrink-0 text-sm font-medium">
                {t("asr.custom.modelId")}
              </label>
              <Input
                className="flex-1"
                placeholder="openai/whisper-large-v3-turbo"
                value={form.modelId}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    modelId: e.target.value,
                    validated: false,
                    error: "",
                  }))
                }
              />
            </div>

            {form.platform === "huggingface" && (
              <div className="flex items-center gap-2">
                <label className="w-20 shrink-0 text-sm font-medium">
                  {t("asr.custom.mirror")}
                </label>
                <Input
                  className="flex-1"
                  placeholder="https://huggingface.co"
                  value={form.mirrorUrl}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, mirrorUrl: e.target.value }))
                  }
                />
              </div>
            )}

            <div className="flex items-center gap-2">
              <label className="w-20 shrink-0 text-sm font-medium">
                VRAM (GB)
              </label>
              <Input
                className="w-24"
                type="number"
                min={0.5}
                step={0.5}
                value={form.vramGb}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    vramGb: parseFloat(e.target.value) || 2,
                  }))
                }
              />
            </div>

            {form.error && (
              <p className="text-sm text-destructive">{form.error}</p>
            )}
            {form.validated && (
              <div className="flex items-center gap-2 text-sm text-green-600">
                <CheckCircle2 className="h-4 w-4" />
                <span>{form.validatedName}</span>
              </div>
            )}

            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setShowAddForm(false);
                  setForm({ ...initialAddForm, mirrorUrl: defaultHfMirror });
                }}
              >
                {t("common:action.cancel")}
              </Button>
              {!form.validated ? (
                <Button
                  size="sm"
                  disabled={!form.modelId.trim() || form.validating}
                  onClick={handleValidate}
                >
                  {form.validating ? (
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Search className="mr-1.5 h-3.5 w-3.5" />
                  )}
                  {t("asr.custom.validate")}
                </Button>
              ) : (
                <Button size="sm" onClick={handleAddModel}>
                  <Plus className="mr-1.5 h-3.5 w-3.5" />
                  {t("asr.custom.add")}
                </Button>
              )}
            </div>
          </div>
        ) : (
          <Button
            variant="outline"
            className="mt-3 w-full"
            onClick={() => setShowAddForm(true)}
          >
            <Plus className="mr-1.5 h-4 w-4" />
            {t("asr.custom.addModel")}
          </Button>
        )}
      </DialogContent>
    </Dialog>
  );
}

async function pushModelsToBackend(models: CustomASRModel[]) {
  try {
    await api.pushCustomModels(
      models.map((m) => ({
        id: m.id,
        name: m.name,
        platform: m.platform,
        model_id: m.modelId,
        mirror_url: m.mirrorUrl || null,
        vram_gb: m.vramGb,
      }))
    );
  } catch {
    // Best effort — ASR service may not be ready
  }
}
