import { useEffect, useState } from "react";
import { Settings } from "lucide-react";
import { Button } from "../ui/button";
import { SettingsDialog } from "../Settings/SettingsDialog";
import { useEngineStore } from "../../stores/engineStore";
import { useSettingsStore } from "../../stores/settingsStore";

export function HeaderBar() {
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

  return (
    <div className="flex items-center gap-3 border-b border-border bg-muted/50 px-4 py-2">
      <div className="ml-auto flex items-center gap-1">
        <Button variant="ghost" size="sm" onClick={() => setSettingsOpen(true)}>
          <Settings className="h-4 w-4" />
        </Button>
      </div>
      <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}
