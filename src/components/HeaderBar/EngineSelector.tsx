import { useTranslation } from "react-i18next";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import { Badge } from "../ui/badge";
import {
  useEngineStore,
  ENGINE_KEYS,
  CLOUD_ENGINES,
  isEngineAvailable,
  isCloudEngineConfigured,
} from "../../stores/engineStore";
import { useSettingsStore } from "../../stores/settingsStore";

export function EngineSelector() {
  const { t } = useTranslation();
  const { engines, selectedEngine, setSelectedEngine } = useEngineStore();
  const cloudAsr = useSettingsStore((s) => s.cloudAsr);

  return (
    <Select value={selectedEngine} onValueChange={setSelectedEngine}>
      <SelectTrigger className="h-8 w-[180px] text-sm">
        <SelectValue placeholder="Select engine">
          {selectedEngine ? t(`engine.${selectedEngine}`) : "Select engine"}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {ENGINE_KEYS.map((key) => {
          const isCloud = CLOUD_ENGINES.has(key);
          const engine = engines.find((e) => e.name === key);
          const available = isEngineAvailable(key, engines, cloudAsr);
          const downloadedCount = engine?.downloaded_models?.length ?? 0;

          return (
            <SelectItem key={key} value={key} disabled={!available}>
              <div className="flex items-center gap-2">
                <span className={available ? "" : "text-muted-foreground"}>
                  {t(`engine.${key}`)}
                </span>
                {/* Local engine: loaded badge */}
                {!isCloud && engine?.is_loaded && (
                  <Badge variant="secondary" className="text-[10px] px-1 py-0">
                    {t("status.loaded")}
                  </Badge>
                )}
                {/* Local engine: downloaded count badge */}
                {!isCloud && downloadedCount > 0 && !engine?.is_loaded && (
                  <Badge variant="outline" className="text-[10px] px-1 py-0 border-blue-300 text-blue-600">
                    {downloadedCount}
                  </Badge>
                )}
                {/* Cloud engine: API configured badge */}
                {isCloud && isCloudEngineConfigured(key, cloudAsr) && (
                  <Badge variant="outline" className="text-[10px] px-1 py-0 border-green-300 text-green-600">
                    {t("status.apiReady")}
                  </Badge>
                )}
              </div>
            </SelectItem>
          );
        })}
      </SelectContent>
    </Select>
  );
}
