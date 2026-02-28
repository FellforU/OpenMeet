import { useState, useEffect, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Shield, Loader2, CheckCircle2, XCircle, RefreshCw, ExternalLink, Search } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Alert, AlertDescription } from "../ui/alert";
import { Switch } from "../ui/switch";
import { cn } from "../../lib/utils";
import { PasswordInput } from "./PasswordInput";
import { testLLMConnection, fetchModelList } from "../../services/llmClient";
import type { ModelType } from "../../stores/settingsStore";
import type { ProviderModelEntry } from "../../stores/settingsStore";

interface FieldDef {
  key: string;
  labelKey: string;
  placeholder: string;
  isPassword: boolean;
}

interface ProviderConfig {
  enabled: boolean;
  apiKey?: string;
  host?: string;
  model?: string;
  modelByType?: Record<string, string | undefined>;
  models?: ProviderModelEntry[];
}

interface ProviderConfigModalProps {
  open: boolean;
  onClose: () => void;
  logoSrc: string;
  providerKey: string;
  providerName: string;
  fields: FieldDef[];
  presetModelsByType: Record<string, string[]>;
  supportedTypes: ModelType[];
  apiKeyUrl?: string;
  config: ProviderConfig;
  onSave: (config: Record<string, unknown>) => void;
}

// Classify a model ID to a ModelType based on presets + heuristics
function classifyModelType(
  modelId: string,
  presetModelsByType: Record<string, string[]>
): ModelType {
  // Check preset lists first
  for (const [type, models] of Object.entries(presetModelsByType)) {
    if (models.includes(modelId)) return type as ModelType;
  }
  // Heuristic fallback
  const lower = modelId.toLowerCase();
  if (lower.includes("embed")) return "EMBEDDING";
  if (lower.includes("rerank")) return "RERANK";
  return "LLM";
}

// Merge remote models with existing saved models, preserving enabled state
function mergeModels(
  remoteIds: string[],
  existingModels: ProviderModelEntry[],
  presetModelsByType: Record<string, string[]>
): ProviderModelEntry[] {
  const existingMap = new Map(existingModels.map((m) => [m.id, m]));
  const seen = new Set<string>();
  const result: ProviderModelEntry[] = [];

  // Add all remote models, preserving existing enabled state
  for (const id of remoteIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    const existing = existingMap.get(id);
    result.push({
      id,
      type: existing?.type ?? classifyModelType(id, presetModelsByType),
      enabled: existing?.enabled ?? true,
    });
  }

  // Add preset models not in remote list
  for (const [type, models] of Object.entries(presetModelsByType)) {
    for (const id of models) {
      if (seen.has(id)) continue;
      seen.add(id);
      const existing = existingMap.get(id);
      result.push({
        id,
        type: (existing?.type ?? type) as ModelType,
        enabled: existing?.enabled ?? false,
      });
    }
  }

  return result;
}

// Group models by type
function groupByType(models: ProviderModelEntry[]): Record<ModelType, ProviderModelEntry[]> {
  return {
    LLM: models.filter((m) => m.type === "LLM"),
    EMBEDDING: models.filter((m) => m.type === "EMBEDDING"),
    RERANK: models.filter((m) => m.type === "RERANK"),
  };
}

export function ProviderConfigModal({
  open,
  onClose,
  logoSrc,
  providerKey,
  providerName,
  fields,
  presetModelsByType,
  supportedTypes,
  apiKeyUrl,
  config,
  onSave,
}: ProviderConfigModalProps) {
  const { t } = useTranslation("settings");
  const [localFields, setLocalFields] = useState<Record<string, string>>({});
  const [localModels, setLocalModels] = useState<ProviderModelEntry[]>([]);
  const [modelFilter, setModelFilter] = useState("");
  const [fetchLoading, setFetchLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [testStatus, setTestStatus] = useState<"idle" | "testing" | "success" | "error">("idle");
  const [testMessage, setTestMessage] = useState("");

  useEffect(() => {
    if (open) {
      // Initialize non-model fields from config
      const fieldValues: Record<string, string> = {};
      for (const field of fields) {
        const val = config[field.key as keyof ProviderConfig];
        if (typeof val === "string") {
          fieldValues[field.key] = val;
        }
      }
      setLocalFields(fieldValues);

      // Initialize models from config.models or generate from presets
      if (config.models && config.models.length > 0) {
        setLocalModels(config.models);
      } else {
        // Generate initial model list from presets
        const initial: ProviderModelEntry[] = [];
        for (const [type, models] of Object.entries(presetModelsByType)) {
          for (const id of models) {
            initial.push({ id, type: type as ModelType, enabled: false });
          }
        }
        setLocalModels(initial);
      }

      setModelFilter("");
      setFetchError(null);
      setTestStatus("idle");
      setTestMessage("");
    }
  }, [open, config, fields, presetModelsByType]);

  const handleFieldChange = (key: string, value: string) => {
    setLocalFields((prev) => ({ ...prev, [key]: value }));
  };

  const connConfig = useMemo(
    () => ({ apiKey: localFields.apiKey, host: localFields.host }),
    [localFields.apiKey, localFields.host]
  );

  // Fetch remote models
  const handleFetchModels = useCallback(async () => {
    setFetchLoading(true);
    setFetchError(null);
    try {
      const remoteIds = await fetchModelList(providerKey, connConfig);
      if (remoteIds.length > 0) {
        setLocalModels((prev) =>
          mergeModels(remoteIds, prev, presetModelsByType)
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setFetchError(msg);
    } finally {
      setFetchLoading(false);
    }
  }, [providerKey, connConfig, presetModelsByType]);

  // Auto-fetch on open if credentials are configured
  // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: only fetch on initial dialog open
  useEffect(() => {
    if (open && supportedTypes.length > 0) {
      const hasCredentials = connConfig.apiKey || connConfig.host;
      if (hasCredentials) {
        handleFetchModels();
      }
    }
  }, [open]);

  // Re-fetch when credentials change (debounced)
  useEffect(() => {
    if (!open || supportedTypes.length === 0) return;
    const hasCredentials = connConfig.apiKey || connConfig.host;
    if (!hasCredentials) return;

    const timer = setTimeout(() => {
      handleFetchModels();
    }, 800);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- debounced fetch on credential change
  }, [connConfig.apiKey, connConfig.host]);

  const handleToggleModel = (modelId: string, enabled: boolean) => {
    setLocalModels((prev) =>
      prev.map((m) => (m.id === modelId ? { ...m, enabled } : m))
    );
  };

  const handleToggleAll = (type: ModelType, enabled: boolean) => {
    setLocalModels((prev) =>
      prev.map((m) => (m.type === type ? { ...m, enabled } : m))
    );
  };

  const handleSave = () => {
    const result: Record<string, unknown> = { ...localFields };

    if (supportedTypes.length > 0) {
      result.models = localModels;

      // Build modelByType from first enabled model of each type (backward compat)
      const modelByType: Record<string, string> = {};
      for (const type of supportedTypes) {
        const firstEnabled = localModels.find(
          (m) => m.type === type && m.enabled
        );
        if (firstEnabled) {
          modelByType[type] = firstEnabled.id;
        }
      }
      result.modelByType = modelByType;
      if (modelByType.LLM) {
        result.model = modelByType.LLM;
      }
    }
    onSave(result);
    onClose();
  };

  const handleTest = async () => {
    setTestStatus("testing");
    setTestMessage("");
    try {
      const firstLLM = localModels.find((m) => m.type === "LLM" && m.enabled);
      const testConfig = {
        ...localFields,
        model: firstLLM?.id || config.model,
        modelByType: { LLM: firstLLM?.id || config.modelByType?.LLM },
      };
      const result = await testLLMConnection(providerKey, testConfig);
      if (result.success) {
        setTestStatus("success");
        setTestMessage(result.message);
      } else {
        setTestStatus("error");
        setTestMessage(result.message);
      }
    } catch (err) {
      setTestStatus("error");
      setTestMessage(err instanceof Error ? err.message : String(err));
    }
  };

  // Filter and group models
  const filteredModels = modelFilter
    ? localModels.filter((m) =>
        m.id.toLowerCase().includes(modelFilter.toLowerCase())
      )
    : localModels;

  const grouped = groupByType(filteredModels);

  const enabledCount = localModels.filter((m) => m.enabled).length;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <img src={logoSrc} alt={providerName} className="h-6 w-6" />
            <DialogTitle>
              {t("llm.configureTitle", { provider: providerName })}
            </DialogTitle>
          </div>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-4 pr-1">
          <Alert>
            <Shield className="h-4 w-4" />
            <AlertDescription>{t("llm.securityNote")}</AlertDescription>
          </Alert>

          {/* Credential fields */}
          <div className="space-y-3">
            {fields.map((field) => (
              <div key={field.key} className="space-y-1.5">
                <label className="text-sm font-medium">{t(field.labelKey)}</label>
                {field.isPassword ? (
                  <PasswordInput
                    value={localFields[field.key] || ""}
                    onChange={(val) => handleFieldChange(field.key, val)}
                    placeholder={field.placeholder}
                  />
                ) : (
                  <Input
                    value={localFields[field.key] || ""}
                    onChange={(e) => handleFieldChange(field.key, e.target.value)}
                    placeholder={field.placeholder}
                  />
                )}
              </div>
            ))}
          </div>

          {/* Model list panel */}
          {supportedTypes.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-medium">{t("llm.modelList")}</h4>
                <span className="text-xs text-muted-foreground">
                  {t("llm.enabledModels", { count: enabledCount })}
                </span>
              </div>

              {/* Search + refresh bar */}
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    className="h-8 pl-8 text-sm"
                    placeholder={t("llm.searchModel")}
                    value={modelFilter}
                    onChange={(e) => setModelFilter(e.target.value)}
                  />
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 shrink-0"
                  onClick={handleFetchModels}
                  disabled={fetchLoading}
                  title={t("llm.fetchModels")}
                >
                  {fetchLoading ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <RefreshCw className="h-3.5 w-3.5" />
                  )}
                </Button>
              </div>

              {fetchError && (
                <p className="text-xs text-destructive">{fetchError}</p>
              )}

              {fetchLoading && localModels.length === 0 && (
                <p className="text-xs text-muted-foreground py-2">
                  {t("llm.fetchingModels")}
                </p>
              )}

              {/* Model list grouped by type */}
              <div className="max-h-[280px] overflow-y-auto space-y-3 rounded-md border p-2">
                {(["LLM", "EMBEDDING", "RERANK"] as ModelType[]).map((type) => {
                  const models = grouped[type];
                  if (models.length === 0) return null;
                  const allEnabled = models.every((m) => m.enabled);

                  return (
                    <div key={type}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-medium text-muted-foreground">
                          {t(`llm.modelType_${type}`)}
                        </span>
                        <button
                          className="text-[10px] text-primary hover:underline"
                          onClick={() => handleToggleAll(type, !allEnabled)}
                        >
                          {allEnabled ? t("llm.disableAll") : t("llm.enableAll")}
                        </button>
                      </div>
                      <div className="space-y-0.5">
                        {models.map((model) => (
                          <div
                            key={`${model.type}-${model.id}`}
                            className="flex items-center justify-between rounded px-2 py-1 hover:bg-accent/50"
                          >
                            <span
                              className={cn(
                                "text-sm truncate mr-2",
                                !model.enabled && "text-muted-foreground"
                              )}
                            >
                              {model.id}
                            </span>
                            <Switch
                              checked={model.enabled}
                              onCheckedChange={(val) =>
                                handleToggleModel(model.id, val)
                              }
                              className="h-4 w-7 shrink-0"
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}

                {filteredModels.length === 0 && !fetchLoading && (
                  <p className="text-xs text-muted-foreground text-center py-4">
                    {localModels.length === 0
                      ? t("llm.noModelsHint")
                      : t("llm.noModelsFound")}
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Test connection */}
          <div>
            <Button
              variant="outline"
              size="sm"
              onClick={handleTest}
              disabled={testStatus === "testing"}
              className="w-full"
            >
              {testStatus === "testing" ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {t("llm.testing")}
                </>
              ) : (
                t("llm.testConnection")
              )}
            </Button>
            {testStatus === "success" && (
              <div className="mt-2 flex items-start gap-2 rounded-md bg-green-50 dark:bg-green-950 p-2 text-sm text-green-700 dark:text-green-300">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{t("llm.testSuccess")}{testMessage && ` — ${testMessage}`}</span>
              </div>
            )}
            {testStatus === "error" && (
              <div className="mt-2 flex items-start gap-2 rounded-md bg-red-50 dark:bg-red-950 p-2 text-sm text-red-700 dark:text-red-300">
                <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{t("llm.testFailed")}{testMessage}</span>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between pt-4 border-t">
          {apiKeyUrl ? (
            <button
              className="flex items-center gap-1 text-xs text-primary hover:underline"
              onClick={() => {
                invoke("open_url", { url: apiKeyUrl }).catch(() => {
                  window.open(apiKeyUrl, "_blank");
                });
              }}
            >
              <ExternalLink className="h-3 w-3" />
              {t("llm.getApiKey")}
            </button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>
              {t("common:action.cancel")}
            </Button>
            <Button onClick={handleSave}>{t("llm.saveBtn")}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
