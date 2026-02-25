import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Settings, Globe } from "lucide-react";
import { Button } from "../ui/button";
import { EngineSelector } from "./EngineSelector";
import { ModelSizeSelector } from "./ModelSizeSelector";
import { LanguageSelector } from "./LanguageSelector";
import { SettingsDialog } from "../Settings/SettingsDialog";
import { useEngineStore } from "../../stores/engineStore";

export function HeaderBar() {
  const { t, i18n } = useTranslation();
  const fetchEngines = useEngineStore((s) => s.fetchEngines);
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    fetchEngines();
  }, [fetchEngines]);

  const toggleUILanguage = () => {
    const next = i18n.language === "zh" ? "en" : "zh";
    i18n.changeLanguage(next);
  };

  return (
    <div className="flex items-center gap-3 border-b border-border bg-muted/50 px-4 py-2">
      <span className="mr-2 font-semibold">ASR</span>
      <div className="flex items-center gap-2">
        <LanguageSelector />
        <EngineSelector />
        <ModelSizeSelector />
      </div>
      <div className="ml-auto flex items-center gap-1">
        <Button variant="ghost" size="sm" onClick={toggleUILanguage} title={t("language.zh") + " / " + t("language.en")}>
          <Globe className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setSettingsOpen(true)}>
          <Settings className="h-4 w-4" />
        </Button>
      </div>
      <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}
