import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Settings, Globe } from "lucide-react";
import { Button } from "../ui/button";
import { LanguageSelector } from "./LanguageSelector";
import { SettingsDialog } from "../Settings/SettingsDialog";
import { useEngineStore } from "../../stores/engineStore";
import { useSettingsStore } from "../../stores/settingsStore";

export function HeaderBar() {
  const { t, i18n } = useTranslation();
  const fetchEngines = useEngineStore((s) => s.fetchEngines);
  const initFromSettings = useEngineStore((s) => s.initFromSettings);
  const loadSettings = useSettingsStore((s) => s.loadSettings);
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    const init = async () => {
      await loadSettings();
      await fetchEngines();
      initFromSettings();
    };
    init();
  }, [fetchEngines, initFromSettings, loadSettings]);

  const toggleUILanguage = () => {
    const next = i18n.language === "zh" ? "en" : "zh";
    i18n.changeLanguage(next);
  };

  return (
    <div className="flex items-center gap-3 border-b border-border bg-muted/50 px-4 py-2">
      <div className="flex items-center gap-2">
        <LanguageSelector />
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
