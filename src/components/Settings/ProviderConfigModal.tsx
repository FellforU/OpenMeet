import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Shield, ChevronsUpDown, Check, Loader2, CheckCircle2, XCircle } from "lucide-react";
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
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from "../ui/command";
import { cn } from "../../lib/utils";
import { PasswordInput } from "./PasswordInput";
import { testLLMConnection } from "../../services/llmClient";

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
  values: Record<string, string>;
  onSave: (values: Record<string, string>) => void;
}

function ModelCombobox({
  value,
  onChange,
  presetModels,
  placeholder,
}: {
  value: string;
  onChange: (val: string) => void;
  presetModels: string[];
  placeholder: string;
}) {
  const { t } = useTranslation("settings");
  const [open, setOpen] = useState(false);
  const [inputValue, setInputValue] = useState("");

  return (
    <Popover open={open} onOpenChange={setOpen}>
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
        <Command shouldFilter={false}>
          <CommandInput
            placeholder={t("llm.searchModel", "搜索或输入模型名称...")}
            value={inputValue}
            onValueChange={setInputValue}
          />
          <CommandList>
            <CommandEmpty>
              {inputValue ? (
                <button
                  className="w-full px-2 py-1.5 text-sm text-left hover:bg-accent rounded-sm cursor-pointer"
                  onClick={() => {
                    onChange(inputValue);
                    setOpen(false);
                    setInputValue("");
                  }}
                >
                  {t("llm.useCustomModel", '使用自定义模型: "{{model}}"', { model: inputValue })}
                </button>
              ) : (
                t("llm.noModelsFound", "未找到匹配的模型")
              )}
            </CommandEmpty>
            <CommandGroup>
              {presetModels
                .filter((m) =>
                  !inputValue || m.toLowerCase().includes(inputValue.toLowerCase())
                )
                .map((model) => (
                  <CommandItem
                    key={model}
                    value={model}
                    onSelect={() => {
                      onChange(model);
                      setOpen(false);
                      setInputValue("");
                    }}
                  >
                    <Check
                      className={cn(
                        "mr-2 h-4 w-4",
                        value === model ? "opacity-100" : "opacity-0"
                      )}
                    />
                    {model}
                  </CommandItem>
                ))}
            </CommandGroup>
          </CommandList>
        </Command>
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
  values,
  onSave,
}: ProviderConfigModalProps) {
  const { t } = useTranslation("settings");
  const [localValues, setLocalValues] = useState<Record<string, string>>({});
  const [testStatus, setTestStatus] = useState<"idle" | "testing" | "success" | "error">("idle");
  const [testMessage, setTestMessage] = useState("");

  useEffect(() => {
    if (open) {
      setLocalValues({ ...values });
      setTestStatus("idle");
      setTestMessage("");
    }
  }, [open, values]);

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
                <ModelCombobox
                  value={localValues[field.key] || ""}
                  onChange={(val) => handleChange(field.key, val)}
                  presetModels={presetModels}
                  placeholder={field.placeholder}
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
                {t("llm.testing", "测试中...")}
              </>
            ) : (
              t("llm.testConnection", "测试连接")
            )}
          </Button>
          {testStatus === "success" && (
            <div className="mt-2 flex items-start gap-2 rounded-md bg-green-50 dark:bg-green-950 p-2 text-sm text-green-700 dark:text-green-300">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{t("llm.testSuccess", "连接成功！")}{testMessage && ` — ${testMessage}`}</span>
            </div>
          )}
          {testStatus === "error" && (
            <div className="mt-2 flex items-start gap-2 rounded-md bg-red-50 dark:bg-red-950 p-2 text-sm text-red-700 dark:text-red-300">
              <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{t("llm.testFailed", "连接失败：")}{testMessage}</span>
            </div>
          )}
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            {t("common:action.cancel")}
          </Button>
          <Button onClick={handleSave}>{t("llm.saveBtn")}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
