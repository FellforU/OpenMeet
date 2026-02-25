import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Download, Trash2 } from "lucide-react";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";
import { useEngineStore } from "../../stores/engineStore";

interface ModelInfo {
  engine: string;
  size: string;
  description: string;
  vramGb: number;
}

const ALL_MODELS: ModelInfo[] = [
  { engine: "whisper", size: "tiny", description: "Fastest, lowest quality", vramGb: 1 },
  { engine: "whisper", size: "base", description: "Good balance for quick tasks", vramGb: 1.5 },
  { engine: "whisper", size: "small", description: "Better accuracy", vramGb: 2 },
  { engine: "whisper", size: "medium", description: "High accuracy", vramGb: 4 },
  { engine: "whisper", size: "large-v3", description: "Best accuracy", vramGb: 6 },
  { engine: "qwen3", size: "qwen3-asr-0.6B", description: "Lightweight, 22 dialects", vramGb: 3 },
  { engine: "qwen3", size: "qwen3-asr-1.7B", description: "Higher accuracy, 22 dialects", vramGb: 6 },
  { engine: "paraformer", size: "paraformer-large", description: "Fast Chinese ASR", vramGb: 2 },
  { engine: "paraformer", size: "paraformer-large-vad-punc", description: "Chinese with VAD + punctuation", vramGb: 2.5 },
  { engine: "paraformer", size: "paraformer-large-vad-punc-spk", description: "Chinese with diarization", vramGb: 3 },
];

const ENGINE_VARIANT_MAP: Record<string, "default" | "secondary" | "outline"> = {
  whisper: "default",
  qwen3: "secondary",
  paraformer: "outline",
};

export function ModelManager() {
  const { t } = useTranslation("settings");
  const { engines, fetchEngines } = useEngineStore();

  useEffect(() => {
    fetchEngines();
  }, [fetchEngines]);

  const loadedModels = new Set<string>();
  for (const e of engines) {
    if (e.is_loaded && e.current_model_size) {
      loadedModels.add(`${e.name}:${e.current_model_size}`);
    }
  }

  return (
    <div className="py-2">
      <h3 className="text-lg font-semibold">{t("models.title")}</h3>
      <p className="mb-4 text-sm text-muted-foreground">
        Manage ASR engine models. Download models for offline use.
      </p>

      <div className="space-y-2">
        {ALL_MODELS.map((model) => {
          const key = `${model.engine}:${model.size}`;
          const isLoaded = loadedModels.has(key);

          return (
            <div
              key={key}
              className="flex items-center justify-between rounded-lg border border-border p-3"
            >
              <div>
                <div className="flex items-center gap-2">
                  <Badge variant={ENGINE_VARIANT_MAP[model.engine] || "secondary"}>
                    {model.engine}
                  </Badge>
                  <span className="font-medium">{model.size}</span>
                  {isLoaded && (
                    <Badge variant="outline" className="text-green-600 border-green-300">
                      {t("common:status.loaded")}
                    </Badge>
                  )}
                </div>
                <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                  <span>{model.description}</span>
                  <Badge variant="outline" className="text-[10px]">
                    {model.vramGb} GB VRAM
                  </Badge>
                </div>
              </div>
              {isLoaded ? (
                <Button variant="destructive" size="sm">
                  <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                  {t("common:action.unload")}
                </Button>
              ) : (
                <Button variant="outline" size="sm">
                  <Download className="mr-1.5 h-3.5 w-3.5" />
                  {t("common:action.download")}
                </Button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
