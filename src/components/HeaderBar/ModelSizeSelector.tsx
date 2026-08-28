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
  FALLBACK_MODEL_SIZES,
  CLOUD_ENGINES,
} from "../../stores/engineStore";

export function ModelSizeSelector() {
  const { t } = useTranslation();
  const { engines, selectedEngine, selectedModelSize, setSelectedModelSize } =
    useEngineStore();

  const isCloud = CLOUD_ENGINES.has(selectedEngine);
  const engine = engines.find((e) => e.name === selectedEngine);
  const sizes = engine?.model_sizes?.length
    ? engine.model_sizes
    : FALLBACK_MODEL_SIZES[selectedEngine] || [];
  const downloadedModels = new Set(engine?.downloaded_models ?? []);

  return (
    <Select
      value={selectedModelSize}
      onValueChange={setSelectedModelSize}
      disabled={sizes.length === 0}
    >
      <SelectTrigger className="h-8 w-[160px] text-sm">
        <SelectValue placeholder={t("model.selectSize")} />
      </SelectTrigger>
      <SelectContent>
        {sizes.map((size) => {
          // Cloud engines: all sizes available; local engines: must be downloaded or loaded
          const isAvailable =
            isCloud ||
            downloadedModels.has(size) ||
            (engine?.is_loaded && engine.current_model_size === size);

          return (
            <SelectItem key={size} value={size} disabled={!isAvailable}>
              <div className="flex items-center gap-2">
                <span className={isAvailable ? "" : "text-muted-foreground"}>
                  {size}
                </span>
                {engine?.is_loaded && engine.current_model_size === size && (
                  <Badge variant="secondary" className="text-[10px] px-1 py-0">
                    {t("status.loaded")}
                  </Badge>
                )}
                {downloadedModels.has(size) &&
                  !(engine?.is_loaded && engine.current_model_size === size) && (
                    <Badge
                      variant="outline"
                      className="text-[10px] px-1 py-0 border-blue-300 text-blue-600"
                    >
                      {t("downloadPhase.completed")}
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
