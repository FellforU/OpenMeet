import { useState, useEffect, useCallback } from "react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import { cn } from "../../lib/utils";
import { PasswordInput } from "./PasswordInput";
import { testLLMConnection, fetchModelList } from "../../services/llmClient";

interface FieldDef {
  key: string;
  labelKey: string;
  placeholder: string;
  isPassword: boolean;
}

interface ProviderConfigModalProps {
  open: boolean;
  onClose: () => void;
  logoSrc: string;
  providerKey: string;
  providerName: string;
  fields: FieldDef[];
  presetModels: string[];
  presetModelsByType?: Record<string, string[]>;
  supportedTypes?: string[];
  apiKeyUrl?: string;
  values: Record<string, string>;
  onSave: (values: Record<string, string>) => void;
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
  presetModels,
  presetModelsByType,
  supportedTypes,
  apiKeyUrl,
  values,
  onSave,
}: ProviderConfigModalProps) {
  const { t } = useTranslation("settings");
  const [localValues, setLocalValues] = useState<Record<string, string>>({});
  const [testStatus, setTestStatus] = useState<"idle" | "testing" | "success" | "error">("idle");
  const [testMessage, setTestMessage] = useState("");
  const [selectedModelType, setSelectedModelType] = useState("LLM");

  useEffect(() => {
    if (open) {
      setLocalValues({ ...values });
      setTestStatus("idle");
      setTestMessage("");
      setSelectedModelType("LLM");
    }
  }, [open, values]);

  // Get preset models based on selected model type
  const activePresetModels = presetModelsByType?.[selectedModelType] ?? presetModels;

  const handleChange = (key: string, value: string) => {
    setLocalValues((prev) => ({ ...prev, [key]: value }));
  };

  const handleSave = () => {
    onSave(localValues);
    onClose();
  };

  const handleTest = async () => {
    setTestStatus("testing");
    setTestMessage("");
    const result = await testLLMConnection(providerKey, localValues);
    if (result.success) {
      setTestStatus("success");
      setTestMessage(result.message);
    } else {
      setTestStatus("error");
      setTestMessage(result.message);
    }
  };

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
          {/* Model type selector */}
          {supportedTypes && supportedTypes.length > 1 && (
            <div className="space-y-1.5">
              <label className="text-sm font-medium">{t("llm.modelType")}</label>
              <Select value={selectedModelType} onValueChange={setSelectedModelType}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {supportedTypes.map((type) => (
                    <SelectItem key={type} value={type}>
                      {type}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {fields.map((field) => (
            <div key={field.key} className="space-y-1.5">
              <label className="text-sm font-medium">{t(field.labelKey)}</label>
              {field.isPassword ? (
                <PasswordInput
                  value={localValues[field.key] || ""}
                  onChange={(val) => handleChange(field.key, val)}
                  placeholder={field.placeholder}
                />
              ) : field.key === "model" ? (
                <ModelSelector
                  value={localValues[field.key] || ""}
                  onChange={(val) => handleChange(field.key, val)}
                  providerKey={providerKey}
                  presetModels={activePresetModels}
                  placeholder={field.placeholder}
                  config={{
                    apiKey: localValues.apiKey,
                    host: localValues.host,
                  }}
                />
              ) : (
                <Input
                  value={localValues[field.key] || ""}
                  onChange={(e) => handleChange(field.key, e.target.value)}
                  placeholder={field.placeholder}
                />
              )}
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
