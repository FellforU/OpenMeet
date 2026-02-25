import { useTranslation } from "react-i18next";
import { Settings, Database, Key, Info } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs";
import { Input } from "../ui/input";
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
import { APIKeyTab } from "./APIKeyTab";

interface SettingsDialogProps {
  open: boolean;
  onClose: () => void;
}

function GeneralSettings() {
  const { t } = useTranslation("settings");

  return (
    <div className="space-y-6 py-2">
      <div className="space-y-2">
        <label className="text-sm font-medium">{t("general.ollamaHost")}</label>
        <p className="text-xs text-muted-foreground">{t("general.ollamaHostDesc")}</p>
        <Input defaultValue="http://localhost:11434" placeholder="http://localhost:11434" />
      </div>
      <div className="space-y-2">
        <label className="text-sm font-medium">{t("general.ollamaModel")}</label>
        <p className="text-xs text-muted-foreground">{t("general.ollamaModelDesc")}</p>
        <Input
          defaultValue="qwen2.5:7b"
          placeholder="例如: qwen2.5:7b, mistral:7b"
        />
      </div>
      <div className="flex items-center justify-between">
        <div>
          <label className="text-sm font-medium">{t("general.autoSummary")}</label>
          <p className="text-xs text-muted-foreground">{t("general.autoSummaryDesc")}</p>
        </div>
        <Switch defaultChecked />
      </div>
      <div className="space-y-2">
        <label className="text-sm font-medium">{t("general.exportFormat")}</label>
        <Select defaultValue="markdown">
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
    <div className="space-y-4 py-2">
      <div className="flex items-center gap-2">
        <span className="text-base font-semibold">OpenMeet</span>
        <Badge variant="secondary">v0.1.0</Badge>
      </div>
      <p className="text-sm text-muted-foreground">
        {t("about.description")}
      </p>
      <div>
        <span className="text-sm text-muted-foreground">{t("about.techStack")}: </span>
        <div className="mt-1 flex flex-wrap gap-1">
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
            <TabsTrigger value="models" className="gap-1.5">
              <Database className="h-3.5 w-3.5" />
              {t("tabs.models")}
            </TabsTrigger>
            <TabsTrigger value="api" className="gap-1.5">
              <Key className="h-3.5 w-3.5" />
              {t("tabs.apiKeys")}
            </TabsTrigger>
            <TabsTrigger value="about" className="gap-1.5">
              <Info className="h-3.5 w-3.5" />
              {t("tabs.about")}
            </TabsTrigger>
          </TabsList>
          <TabsContent value="general" className="max-h-[400px] overflow-y-auto">
            <GeneralSettings />
          </TabsContent>
          <TabsContent value="models" className="max-h-[400px] overflow-y-auto">
            <ModelManager />
          </TabsContent>
          <TabsContent value="api" className="max-h-[400px] overflow-y-auto">
            <APIKeyTab />
          </TabsContent>
          <TabsContent value="about" className="max-h-[400px] overflow-y-auto">
            <AboutSection />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
