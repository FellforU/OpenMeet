import { useTranslation } from "react-i18next";
import { Switch } from "../ui/switch";
import { SystemModelSelector } from "./SystemModelSelector";
import { LLM_PROVIDERS } from "./LLMProviderTab";
import { useSettingsStore } from "../../stores/settingsStore";

export function KnowledgeSettings() {
  const { t } = useTranslation("settings");
  const { general, setGeneral } = useSettingsStore();

  const hasRerankProviders = LLM_PROVIDERS.some((p) =>
    p.supportedTypes.includes("RERANK")
  );

  return (
    <div className="space-y-6 py-2">
      <div>
        <h3 className="text-base font-medium">{t("knowledge.title")}</h3>
        <p className="text-xs text-muted-foreground">
          {t("knowledge.subtitle")}
        </p>
      </div>

      {/* Default Embedding Model */}
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

      {/* Enable Rerank toggle */}
      {hasRerankProviders && (
        <>
          <div className="flex items-center justify-between">
            <div>
              <label className="text-sm font-medium">
                {t("knowledge.enableRerank")}
              </label>
              <p className="text-xs text-muted-foreground">
                {t("knowledge.enableRerankDesc")}
              </p>
            </div>
            <Switch
              checked={general.enableRerank}
              onCheckedChange={(v) => setGeneral({ enableRerank: v })}
            />
          </div>

          {/* Default Rerank Model (shown only when rerank is enabled) */}
          {general.enableRerank && (
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
        </>
      )}
    </div>
  );
}
