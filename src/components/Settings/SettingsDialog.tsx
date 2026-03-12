import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { Settings, BrainCircuit, Mic, Info, FolderOpen, Loader2, BookOpenText, AudioWaveform } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
} from "../ui/alert-dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs";
import { Switch } from "../ui/switch";
import { Input } from "../ui/input";
import { Button } from "../ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import { Badge } from "../ui/badge";
import { ModelManager } from "./ModelManager";
import { KnowledgeSettings } from "./KnowledgeSettings";
import { LLMProviderTab } from "./LLMProviderTab";
import { SystemModelSelector } from "./SystemModelSelector";
import { VoiceprintList } from "../VoiceprintLibrary/VoiceprintList";
import { useSettingsStore } from "../../stores/settingsStore";
import { restartAsrService } from "../../services/asrClient";
import logoWithText from "../../../ico/OpenMeet_1.png";

interface SettingsDialogProps {
  open: boolean;
  onClose: () => void;
}

function GeneralSettings() {
  const { t } = useTranslation("settings");
  const { general, setGeneral } = useSettingsStore();

  const [defaultCachePath, setDefaultCachePath] = useState("");
  const [migrateOpen, setMigrateOpen] = useState(false);
  const [pendingNewDir, setPendingNewDir] = useState("");
  const [migrating, setMigrating] = useState(false);

  useEffect(() => {
    invoke<string>("get_default_cache_dir")
      .then(setDefaultCachePath)
      .catch(() => {});
  }, []);

  const handlePickFolder = useCallback(async () => {
    try {
      const picked = await invoke<string | null>("pick_folder");
      if (!picked) return;

      const oldDir = general.cacheDir || defaultCachePath;
      if (picked === oldDir) return;

      setPendingNewDir(picked);
      setMigrateOpen(true);
    } catch {
      // User cancelled or dialog unavailable
    }
  }, [general.cacheDir, defaultCachePath]);

  const handleMigrateSkip = useCallback(async () => {
    setMigrateOpen(false);
    await setGeneral({ cacheDir: pendingNewDir });
    toast.success(t("general.cacheDir"));
    // Restart ASR service with new cache directory
    try {
      const g = useSettingsStore.getState().general;
      await restartAsrService(pendingNewDir, (g.enableHfMirror && g.hfMirror) || undefined);
    } catch {
      toast.warning(t("general.restartAsrFailed"));
    }
  }, [pendingNewDir, setGeneral, t]);

  const handleMigrateConfirm = useCallback(async () => {
    const from = general.cacheDir || defaultCachePath;
    setMigrating(true);
    try {
      const result = await invoke<string>("migrate_cache_dir", {
        from,
        to: pendingNewDir,
      });
      await setGeneral({ cacheDir: pendingNewDir });
      toast.success(t("general.migrateSuccess") + ` (${result})`);
      // Restart ASR service with new cache directory
      try {
        const { hfMirror } = useSettingsStore.getState().general;
        await restartAsrService(pendingNewDir, hfMirror || undefined);
      } catch {
        toast.warning(t("general.restartAsrFailed"));
      }
    } catch (err) {
      toast.error(t("general.migrateFailed", { error: String(err) }));
    } finally {
      setMigrating(false);
      setMigrateOpen(false);
    }
  }, [general.cacheDir, defaultCachePath, pendingNewDir, setGeneral, t]);

  const handleOpenFolder = useCallback(() => {
    const dir = general.cacheDir || defaultCachePath;
    if (dir) {
      invoke("reveal_file", { path: dir }).catch(() => {});
    }
  }, [general.cacheDir, defaultCachePath]);

  const handleClearCacheDir = useCallback(async () => {
    await setGeneral({ cacheDir: "" });
  }, [setGeneral]);

  return (
    <div className="space-y-6 py-2">
      <div className="space-y-2">
        <label className="text-sm font-medium">
          {t("general.defaultLLMModel")}
        </label>
        <p className="text-xs text-muted-foreground">
          {t("general.defaultLLMModelDesc")}
        </p>
        <SystemModelSelector
          value={general.defaultLLMModel}
          onChange={(v) => setGeneral({ defaultLLMModel: v })}
          modelType="LLM"
        />
      </div>
      <div className="flex items-center justify-between">
        <div>
          <label className="text-sm font-medium">
            {t("general.autoSummary")}
          </label>
          <p className="text-xs text-muted-foreground">
            {t("general.autoSummaryDesc")}
          </p>
        </div>
        <Switch
          checked={general.autoSummary}
          onCheckedChange={(v) => setGeneral({ autoSummary: v })}
        />
      </div>
      <div className="space-y-2">
        <label className="text-sm font-medium">
          {t("general.exportFormat")}
        </label>
        <Select
          value={general.exportFormat}
          onValueChange={(v) =>
            setGeneral({ exportFormat: v as "markdown" | "txt" | "json" })
          }
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="markdown">Markdown</SelectItem>
            <SelectItem value="txt">Plain Text</SelectItem>
            <SelectItem value="json">JSON</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Cache Directory */}
      <div className="space-y-2">
        <label className="text-sm font-medium">
          {t("general.cacheDir")}
        </label>
        <p className="text-xs text-muted-foreground">
          {t("general.cacheDirDesc")}
        </p>
        <div className="flex items-center gap-2">
          <Input
            readOnly
            value={general.cacheDir}
            placeholder={defaultCachePath ? t("general.defaultCachePath", { path: defaultCachePath }) : ""}
            className="flex-1 text-xs"
          />
          <Button variant="outline" size="sm" onClick={handlePickFolder}>
            {t("general.selectFolder")}
          </Button>
          <Button variant="ghost" size="sm" onClick={handleOpenFolder} title={t("general.openFolder")}>
            <FolderOpen className="h-4 w-4" />
          </Button>
        </div>
        {general.cacheDir && (
          <button
            onClick={handleClearCacheDir}
            className="text-xs text-muted-foreground underline hover:text-foreground"
          >
            {t("general.defaultCachePath", { path: defaultCachePath })}
          </button>
        )}
      </div>

      {/* HuggingFace Mirror */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <div>
            <label className="text-sm font-medium">
              {t("general.hfMirror")}
            </label>
            <p className="text-xs text-muted-foreground">
              {t("general.hfMirrorDesc")}
            </p>
          </div>
          <Switch
            checked={general.enableHfMirror}
            onCheckedChange={async (v) => {
              await setGeneral({ enableHfMirror: v });
              // Restart ASR service so HF_ENDPOINT env var takes effect for downloads
              try {
                const g = useSettingsStore.getState().general;
                await restartAsrService(
                  g.cacheDir || undefined,
                  (v && g.hfMirror) || undefined,
                );
              } catch {
                // ASR service may not be running yet
              }
            }}
          />
        </div>
        {general.enableHfMirror && (
          <Input
            value={general.hfMirror}
            placeholder="https://hf-mirror.com"
            className="text-xs"
            onChange={(e) => setGeneral({ hfMirror: e.target.value })}
            onBlur={async () => {
              try {
                const g = useSettingsStore.getState().general;
                await restartAsrService(
                  g.cacheDir || undefined,
                  g.hfMirror || undefined,
                );
              } catch {
                // ASR service may not be running yet
              }
            }}
          />
        )}
      </div>

      {/* HuggingFace Token */}
      <div className="space-y-2">
        <label className="text-sm font-medium">
          {t("general.hfToken")}
        </label>
        <p className="text-xs text-muted-foreground">
          {t("general.hfTokenDesc")}
        </p>
        <Input
          type="password"
          value={general.hfToken}
          placeholder={t("general.hfTokenPlaceholder")}
          className="text-xs font-mono"
          onChange={(e) => setGeneral({ hfToken: e.target.value })}
        />
      </div>

      {/* Post-processing Settings */}
      <div className="space-y-3 rounded-lg border p-4">
        <h3 className="text-sm font-semibold">{t("general.postProcessingTitle")}</h3>

        <div className="flex items-center justify-between">
          <div>
            <label className="text-sm font-medium">
              {t("general.enableHallucinationDetection")}
            </label>
            <p className="text-xs text-muted-foreground">
              {t("general.enableHallucinationDetectionDesc")}
            </p>
          </div>
          <Switch
            checked={general.enableHallucinationDetection}
            onCheckedChange={(v) => setGeneral({ enableHallucinationDetection: v })}
          />
        </div>

        <div className="flex items-center justify-between">
          <div>
            <label className="text-sm font-medium">
              {t("general.enableItn")}
            </label>
            <p className="text-xs text-muted-foreground">
              {t("general.enableItnDesc")}
            </p>
          </div>
          <Switch
            checked={general.enableItn}
            onCheckedChange={(v) => setGeneral({ enableItn: v })}
          />
        </div>

        <div className="flex items-center justify-between">
          <div>
            <label className="text-sm font-medium">
              {t("general.enableSpeechCleaning")}
            </label>
            <p className="text-xs text-muted-foreground">
              {t("general.enableSpeechCleaningDesc")}
            </p>
          </div>
          <Switch
            checked={general.enableSpeechCleaning}
            onCheckedChange={(v) => setGeneral({ enableSpeechCleaning: v })}
          />
        </div>

        {general.enableSpeechCleaning && (
          <div className="space-y-1 pl-4">
            <label className="text-sm font-medium">
              {t("general.cleaningIntensity")}
            </label>
            <Select
              value={general.cleaningIntensity}
              onValueChange={(v) =>
                setGeneral({ cleaningIntensity: v as "light" | "medium" | "heavy" })
              }
            >
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="light">{t("general.light")}</SelectItem>
                <SelectItem value="medium">{t("general.medium")}</SelectItem>
                <SelectItem value="heavy">{t("general.heavy")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}

        <div className="flex items-center justify-between">
          <div>
            <label className="text-sm font-medium">
              {t("general.enableLlmCorrection")}
            </label>
            <p className="text-xs text-muted-foreground">
              {t("general.enableLlmCorrectionDesc")}
            </p>
          </div>
          <Switch
            checked={general.enableLlmCorrection}
            onCheckedChange={(v) => setGeneral({ enableLlmCorrection: v })}
          />
        </div>

        <div className="flex items-center justify-between">
          <div>
            <label className="text-sm font-medium">
              {t("general.enableSegmentation")}
            </label>
            <p className="text-xs text-muted-foreground">
              {t("general.enableSegmentationDesc")}
            </p>
          </div>
          <Switch
            checked={general.enableSegmentation}
            onCheckedChange={(v) => setGeneral({ enableSegmentation: v })}
          />
        </div>

        <div className="flex items-center justify-between">
          <div>
            <label className="text-sm font-medium">
              {t("general.enablePunctuation")}
            </label>
            <p className="text-xs text-muted-foreground">
              {t("general.enablePunctuationDesc")}
            </p>
          </div>
          <Switch
            checked={general.enablePunctuation}
            onCheckedChange={(v) => setGeneral({ enablePunctuation: v })}
          />
        </div>

        <div className="flex items-center justify-between">
          <div>
            <label className="text-sm font-medium">
              {t("general.enableDiarization")}
            </label>
            <p className="text-xs text-muted-foreground">
              {t("general.enableDiarizationDesc")}
            </p>
          </div>
          <Switch
            checked={general.enableDiarization}
            onCheckedChange={(v) => setGeneral({ enableDiarization: v })}
          />
        </div>
      </div>

      {/* Voiceprint Matching Threshold */}
      <div className="space-y-2">
        <label className="text-sm font-medium">
          {t("general.diarizationThreshold")}
        </label>
        <p className="text-xs text-muted-foreground">
          {t("general.diarizationThresholdDesc")}
        </p>
        <div className="flex items-center gap-3">
          <input
            type="range"
            min="0"
            max="100"
            value={Math.round(general.diarizationThreshold * 100)}
            onChange={(e) =>
              setGeneral({ diarizationThreshold: Number(e.target.value) / 100 })
            }
            className="flex-1"
          />
          <span className="w-12 text-right text-sm font-mono">
            {Math.round(general.diarizationThreshold * 100)}%
          </span>
        </div>
      </div>

      {/* Migration Confirm Dialog */}
      <AlertDialog open={migrateOpen} onOpenChange={setMigrateOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("general.migrateCacheTitle")}</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p>{t("general.migrateCacheDesc")}</p>
                <div className="rounded-md bg-muted p-3 text-xs font-mono space-y-1">
                  <p><span className="font-semibold">{t("general.migrateFrom")}:</span> {general.cacheDir || defaultCachePath}</p>
                  <p><span className="font-semibold">{t("general.migrateTo")}:</span> {pendingNewDir}</p>
                </div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={handleMigrateSkip} disabled={migrating}>
              {t("general.migrateSkip")}
            </AlertDialogCancel>
            <AlertDialogAction onClick={handleMigrateConfirm} disabled={migrating}>
              {migrating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {migrating ? t("general.migrating") : t("general.migrateConfirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function AboutSection() {
  const { t } = useTranslation("settings");

  return (
    <div className="flex flex-col items-center space-y-4 py-6">
      <img
        src={logoWithText}
        alt="OpenMeet"
        className="h-32 w-32 object-contain"
      />
      <Badge variant="secondary">v0.1.0</Badge>
      <p className="text-center text-sm text-muted-foreground">
        {t("about.description")}
      </p>
      <div className="text-center">
        <span className="text-sm text-muted-foreground">
          {t("about.techStack")}
        </span>
        <div className="mt-1 flex flex-wrap justify-center gap-1">
          <Badge variant="outline">Tauri 2.x</Badge>
          <Badge variant="outline">React 19</Badge>
          <Badge variant="outline">FastAPI</Badge>
          <Badge variant="outline">Ollama</Badge>
        </div>
      </div>
    </div>
  );
}

export function SettingsDialog({ open, onClose }: SettingsDialogProps) {
  const { t } = useTranslation("settings");

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
        </DialogHeader>
        <Tabs defaultValue="general" className="mt-2">
          <TabsList>
            <TabsTrigger value="general" className="gap-1.5">
              <Settings className="h-3.5 w-3.5" />
              {t("tabs.general")}
            </TabsTrigger>
            <TabsTrigger value="llm" className="gap-1.5">
              <BrainCircuit className="h-3.5 w-3.5" />
              {t("tabs.llmModels")}
            </TabsTrigger>
            <TabsTrigger value="asr" className="gap-1.5">
              <Mic className="h-3.5 w-3.5" />
              {t("tabs.asrModels")}
            </TabsTrigger>
            <TabsTrigger value="voiceprint" className="gap-1.5">
              <AudioWaveform className="h-3.5 w-3.5" />
              {t("tabs.voiceprint")}
            </TabsTrigger>
            <TabsTrigger value="knowledge" className="gap-1.5">
              <BookOpenText className="h-3.5 w-3.5" />
              {t("tabs.knowledge")}
            </TabsTrigger>
            <TabsTrigger value="about" className="gap-1.5">
              <Info className="h-3.5 w-3.5" />
              {t("tabs.about")}
            </TabsTrigger>
          </TabsList>
          <div className="min-h-[480px]">
            <TabsContent value="general" className="max-h-[480px] overflow-y-auto">
              <GeneralSettings />
            </TabsContent>
            <TabsContent value="llm" className="max-h-[480px] overflow-y-auto">
              <LLMProviderTab />
            </TabsContent>
            <TabsContent value="asr" className="max-h-[480px] overflow-y-auto">
              <ModelManager />
            </TabsContent>
            <TabsContent value="voiceprint" className="max-h-[480px] overflow-y-auto">
              <VoiceprintList />
            </TabsContent>
            <TabsContent value="knowledge" className="max-h-[480px] overflow-y-auto">
              <KnowledgeSettings />
            </TabsContent>
            <TabsContent value="about" className="max-h-[480px] overflow-y-auto">
              <AboutSection />
            </TabsContent>
          </div>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
