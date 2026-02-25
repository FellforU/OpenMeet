import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Shield } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Alert, AlertDescription } from "../ui/alert";
import { PasswordInput } from "./PasswordInput";

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
  providerName: string;
  fields: FieldDef[];
  values: Record<string, string>;
  onSave: (values: Record<string, string>) => void;
}

export function ProviderConfigModal({
  open,
  onClose,
  logoSrc,
  providerName,
  fields,
  values,
  onSave,
}: ProviderConfigModalProps) {
  const { t } = useTranslation("settings");
  const [localValues, setLocalValues] = useState<Record<string, string>>({});

  useEffect(() => {
    if (open) {
      setLocalValues({ ...values });
    }
  }, [open, values]);

  const handleChange = (key: string, value: string) => {
    setLocalValues((prev) => ({ ...prev, [key]: value }));
  };

  const handleSave = () => {
    onSave(localValues);
    onClose();
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
