import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Button } from "../ui/button";

interface ProjectNameDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: (name: string) => void;
  title: string;
  defaultValue?: string;
}

export function ProjectNameDialog({
  open,
  onClose,
  onConfirm,
  title,
  defaultValue = "",
}: ProjectNameDialogProps) {
  const { t } = useTranslation();
  const [value, setValue] = useState(defaultValue);

  useEffect(() => {
    if (open) setValue(defaultValue);
  }, [open, defaultValue]);

  const handleConfirm = () => {
    const trimmed = value.trim();
    if (!trimmed) return;
    onConfirm(trimmed);
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-[360px]">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <Input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleConfirm();
          }}
          placeholder={t("sidebar.projectNamePlaceholder")}
          autoFocus
        />
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose}>
            {t("action.cancel")}
          </Button>
          <Button size="sm" onClick={handleConfirm} disabled={!value.trim()}>
            {t("action.confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
