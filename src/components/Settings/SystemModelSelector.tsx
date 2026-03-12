import { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { ChevronsUpDown, Check, Search, HardDrive } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { cn } from "../../lib/utils";
import { useSettingsStore, parseModelRef } from "../../stores/settingsStore";
import type { ModelType } from "../../stores/settingsStore";
import { LLM_PROVIDERS } from "./LLMProviderTab";

export interface ExtraModelGroup {
  providerKey: string;
  providerName: string;
  logoSrc: string;
  models: GroupedModel[];
}

interface SystemModelSelectorProps {
  value: string;           // compound key "provider/model" or ""
  onChange: (ref: string) => void;
  modelType: ModelType;
  placeholder?: string;
  extraGroups?: ExtraModelGroup[];
}

interface GroupedModel {
  providerKey: string;
  providerName: string;
  logoSrc: string;
  modelId: string;
  ref: string;             // compound key
}

export function SystemModelSelector({
  value,
  onChange,
  modelType,
  placeholder,
  extraGroups,
}: SystemModelSelectorProps) {
  const { t } = useTranslation("settings");
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const { llmProviders } = useSettingsStore();

  // Collect enabled models of the given type from all enabled providers
  const groups = useMemo(() => {
    const result: { providerKey: string; providerName: string; logoSrc: string; models: GroupedModel[] }[] = [];

    for (const providerDef of LLM_PROVIDERS) {
      const config = llmProviders[providerDef.key];
      if (!config?.enabled) continue;
      if (!providerDef.supportedTypes.includes(modelType)) continue;

      const enabledModels = (config.models || [])
        .filter((m) => m.enabled && m.type === modelType)
        .map((m) => ({
          providerKey: providerDef.key,
          providerName: t(`llm.${providerDef.key}`),
          logoSrc: providerDef.logoSrc,
          modelId: m.id,
          ref: `${providerDef.key}/${m.id}`,
        }));

      if (enabledModels.length > 0) {
        result.push({
          providerKey: providerDef.key,
          providerName: t(`llm.${providerDef.key}`),
          logoSrc: providerDef.logoSrc,
          models: enabledModels,
        });
      }
    }

    // Prepend extra groups (local models) if provided
    if (extraGroups) {
      return [...extraGroups, ...result];
    }
    return result;
  }, [llmProviders, modelType, t, extraGroups]);

  const allModels = useMemo(
    () => groups.flatMap((g) => g.models),
    [groups]
  );

  const filtered = useMemo(() => {
    if (!filter) return groups;
    const lowerFilter = filter.toLowerCase();
    return groups
      .map((g) => ({
        ...g,
        models: g.models.filter(
          (m) =>
            m.modelId.toLowerCase().includes(lowerFilter) ||
            m.providerName.toLowerCase().includes(lowerFilter)
        ),
      }))
      .filter((g) => g.models.length > 0);
  }, [groups, filter]);

  // Display label for the selected model
  const displayLabel = useMemo(() => {
    if (!value) return "";
    const { provider, model } = parseModelRef(value);
    // Check extraGroups first (local models)
    if (extraGroups) {
      for (const g of extraGroups) {
        const found = g.models.find((m) => m.ref === value);
        if (found) return `${g.providerName} > ${found.modelId}`;
      }
    }
    const providerDef = LLM_PROVIDERS.find((p) => p.key === provider);
    const providerName = providerDef ? t(`llm.${providerDef.key}`) : provider;
    return `${providerName} > ${model}`;
  }, [value, t, extraGroups]);

  const hasModels = allModels.length > 0;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between font-normal"
        >
          <span className={cn("truncate", !value && "text-muted-foreground")}>
            {displayLabel || placeholder || t("llm.selectModel")}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        {!hasModels ? (
          <div className="p-4 text-center text-sm text-muted-foreground">
            {t("llm.noEnabledModels")}
          </div>
        ) : (
          <>
            {/* Search bar */}
            <div className="flex items-center border-b px-3">
              <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <Input
                className="h-9 border-0 px-2 shadow-none focus-visible:ring-0"
                placeholder={t("llm.searchModel")}
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              />
            </div>

            {/* Grouped model list */}
            <div className="max-h-[280px] overflow-y-auto p-1">
              {filtered.map((group) => (
                <div key={group.providerKey}>
                  {/* Provider group header */}
                  <div className="flex items-center gap-1.5 px-2 py-1.5 text-xs font-medium text-muted-foreground">
                    {group.logoSrc ? (
                      <img
                        src={group.logoSrc}
                        alt={group.providerName}
                        className="h-3.5 w-3.5"
                      />
                    ) : (
                      <HardDrive className="h-3.5 w-3.5" />
                    )}
                    {group.providerName}
                  </div>
                  {/* Models */}
                  {group.models.map((model) => (
                    <button
                      key={model.ref}
                      className="flex w-full items-center rounded-sm px-2 py-1.5 pl-6 text-sm hover:bg-accent"
                      onClick={() => {
                        onChange(model.ref);
                        setOpen(false);
                        setFilter("");
                      }}
                    >
                      <Check
                        className={cn(
                          "mr-2 h-3.5 w-3.5 shrink-0",
                          value === model.ref ? "opacity-100" : "opacity-0"
                        )}
                      />
                      {model.modelId}
                    </button>
                  ))}
                </div>
              ))}

              {filtered.length === 0 && filter && (
                <p className="px-2 py-3 text-center text-xs text-muted-foreground">
                  {t("llm.noModelsFound")}
                </p>
              )}
            </div>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}
