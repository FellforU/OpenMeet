import { useTranslation } from "react-i18next";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import { Badge } from "../ui/badge";
import { useEngineStore } from "../../stores/engineStore";

const ENGINE_KEYS = ["whisper", "qwen3", "paraformer"] as const;

export function EngineSelector() {
  const { t } = useTranslation();
  const { engines, selectedEngine, setSelectedEngine } = useEngineStore();

  return (
    <Select value={selectedEngine} onValueChange={setSelectedEngine}>
      <SelectTrigger className="h-8 w-[180px] text-sm">
        <SelectValue placeholder="Select engine">
          {selectedEngine ? t(`engine.${selectedEngine}`) : "Select engine"}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {ENGINE_KEYS.map((key) => {
          const engine = engines.find((e) => e.name === key);
          const downloadedCount = engine?.downloaded_models?.length ?? 0;
          return (
            <SelectItem key={key} value={key}>
              <div className="flex items-center gap-2">
                <span>{t(`engine.${key}`)}</span>
                {engine?.is_loaded && (
                  <Badge variant="secondary" className="text-[10px] px-1 py-0">
                    {t("status.loaded")}
                  </Badge>
                )}
                {downloadedCount > 0 && !engine?.is_loaded && (
                  <Badge variant="outline" className="text-[10px] px-1 py-0 border-blue-300 text-blue-600">
                    {downloadedCount}
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
