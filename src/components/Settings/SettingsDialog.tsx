import { useTranslation } from "react-i18next";
import { Settings, BrainCircuit, Mic, Info } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs";
import { Switch } from "../ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import { Badge } from "../ui/badge";
import { ModelManager } from "./ModelManager";
import { LLMProviderTab, LLM_PROVIDERS } from "./LLMProviderTab";
import { SystemModelSelector } from "./SystemModelSelector";
import { useSettingsStore } from "../../stores/settingsStore";
import logoWithText from "../../../ico/OpenMeet_1.png";

interface SettingsDialogProps {
  open: boolean;
  onClose: () => void;
}

function GeneralSettings() {
  const { t } = useTranslation("settings");
  const { general, setGeneral } = useSettingsStore();

  const hasRerankProviders = LLM_PROVIDERS.some((p) =>
    p.supportedTypes.includes("RERANK")
  );

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
        />
      </div>
      {hasRerankProviders && (
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
            <TabsContent value="about" className="max-h-[480px] overflow-y-auto">
              <AboutSection />
            </TabsContent>
          </div>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
