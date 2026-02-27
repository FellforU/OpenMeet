import { useState, useEffect, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Shield, ChevronsUpDown, Check, Loader2, CheckCircle2, XCircle, RefreshCw, ExternalLink } from "lucide-react";
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
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { cn } from "../../lib/utils";
import { PasswordInput } from "./PasswordInput";
import { testLLMConnection, fetchModelList } from "../../services/llmClient";

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
}

interface ProviderConfigModalProps {
  open: boolean;
  onClose: () => void;
  logoSrc: string;
  providerKey: string;
  providerName: string;
  fields: FieldDef[];
  presetModelsByType: Record<string, string[]>;
  supportedTypes: string[];
  apiKeyUrl?: string;
  config: ProviderConfig;
  onSave: (config: Record<string, unknown>) => void;
}

function ModelSelector({
  value,
  onChange,
  providerKey,
  presetModels,
  placeholder,
  config,
}: {
  value: string;
  onChange: (val: string) => void;
  providerKey: string;
  presetModels: string[];
  placeholder: string;
  config: { apiKey?: string; host?: string };
}) {
  const { t } = useTranslation("settings");
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const [remoteModels, setRemoteModels] = useState<string[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const models = remoteModels ?? presetModels;

  const filtered = filter
    ? models.filter((m) => m.toLowerCase().includes(filter.toLowerCase()))
    : models;

  const loadModels = useCallback(async () => {
    setLoading(true);
    setFetchError(null);
    try {
      const list = await fetchModelList(providerKey, config);
      setRemoteModels(list.length > 0 ? list : null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setFetchError(msg);
      setRemoteModels(null);
    } finally {
      setLoading(false);
    }
  }, [providerKey, config]);

  const handleOpen = (isOpen: boolean) => {
    setOpen(isOpen);
    if (isOpen && remoteModels === null && !loading) {
      loadModels();
    }
  };

  return (
    <Popover open={open} onOpenChange={handleOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between font-normal"
        >
          <span className={cn(!value && "text-muted-foreground")}>
            {value || placeholder}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <div className="flex items-center border-b px-3">
          <Input
            className="h-9 border-0 px-0 shadow-none focus-visible:ring-0"
            placeholder={t("llm.searchModel")}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 shrink-0 p-0"
            onClick={loadModels}
            disabled={loading}
            title={t("llm.fetchModels")}
          >
            {loading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
          </Button>
        </div>

        <div className="max-h-[240px] overflow-y-auto p-1">
          {fetchError && (
            <p className="px-2 py-1.5 text-xs text-muted-foreground">
              {fetchError}
            </p>
          )}

          {filtered.length === 0 && filter && (
            <button
              className="flex w-full items-center rounded-sm px-2 py-1.5 text-sm hover:bg-accent"
              onClick={() => {
                onChange(filter);
                setOpen(false);
                setFilter("");
              }}
            >
              {t("llm.useCustomModel", { model: filter })}
            </button>
          )}

          {filtered.map((model) => (
            <button
              key={model}
              className="flex w-full items-center rounded-sm px-2 py-1.5 text-sm hover:bg-accent"
              onClick={() => {
                onChange(model);
                setOpen(false);
                setFilter("");
              }}
            >
              <Check
                className={cn(
                  "mr-2 h-4 w-4 shrink-0",
                  value === model ? "opacity-100" : "opacity-0"
                )}
              />
              {model}
            </button>
          ))}

          {filtered.length === 0 && !filter && !loading && (
            <p className="px-2 py-1.5 text-xs text-muted-foreground">
              {t("llm.noModelsFound")}
            </p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
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
  const [localModelByType, setLocalModelByType] = useState<Record<string, string>>({});
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

      // Initialize per-type models from config.modelByType, fallback LLM to config.model
      const modelByType: Record<string, string> = {};
      for (const type of supportedTypes) {
        const fromType = config.modelByType?.[type];
        if (fromType) {
          modelByType[type] = fromType;
        } else if (type === "LLM" && config.model) {
          modelByType[type] = config.model;
        }
      }
      setLocalModelByType(modelByType);

      setTestStatus("idle");
      setTestMessage("");
    }
  }, [open, config, fields, supportedTypes]);

  const handleFieldChange = (key: string, value: string) => {
    setLocalFields((prev) => ({ ...prev, [key]: value }));
  };

  const handleModelChange = (type: string, value: string) => {
    setLocalModelByType((prev) => ({ ...prev, [type]: value }));
  };

  const handleSave = () => {
    const result: Record<string, unknown> = { ...localFields };
    // Only write modelByType/model when per-type selectors are active (LLM providers)
    // Cloud ASR providers pass supportedTypes=[] and keep model in localFields
    if (supportedTypes.length > 0) {
      result.modelByType = { ...localModelByType };
      if (localModelByType.LLM) {
        result.model = localModelByType.LLM;
      }
    }
    onSave(result);
    onClose();
  };

  const handleTest = async () => {
    setTestStatus("testing");
    setTestMessage("");
    // Test using LLM model only
    const testConfig = {
      ...localFields,
      model: localModelByType.LLM || config.model,
      modelByType: localModelByType,
    };
    const result = await testLLMConnection(providerKey, testConfig);
    if (result.success) {
      setTestStatus("success");
      setTestMessage(result.message);
    } else {
      setTestStatus("error");
      setTestMessage(result.message);
    }
  };

  const connConfig = useMemo(
    () => ({ apiKey: localFields.apiKey, host: localFields.host }),
    [localFields.apiKey, localFields.host]
  );

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <img src={logoSrc} alt={providerName} className="h-6 w-6" />
            <DialogTitle>
              {t("llm.configureTitle", { provider: providerName })}
            </DialogTitle>
          </div>
        </DialogHeader>

        <Alert className="mt-2">
          <Shield className="h-4 w-4" />
          <AlertDescription>{t("llm.securityNote")}</AlertDescription>
        </Alert>

        <div className="mt-4 space-y-4">
          {/* Non-model fields (apiKey, host, etc.) */}
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

          {/* Per-type model selectors */}
          {supportedTypes.map((type) => (
            <div key={type} className="space-y-1.5">
              <label className="text-sm font-medium">
                {t(`llm.modelType_${type}`)}
              </label>
              <ModelSelector
                value={localModelByType[type] || ""}
                onChange={(val) => handleModelChange(type, val)}
                providerKey={providerKey}
                presetModels={presetModelsByType[type] || []}
                placeholder={t("llm.selectModel")}
                config={connConfig}
              />
            </div>
          ))}
        </div>

        {/* Test connection section */}
        <div className="mt-4">
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

        <div className="mt-6 flex items-center justify-between">
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
