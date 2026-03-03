import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Button } from "../ui/button";
import { Textarea } from "../ui/textarea";
import type { VoiceprintInfo, VoiceprintMetadata } from "../../types";

interface VoiceprintEditDialogProps {
  open: boolean;
  voiceprint: VoiceprintInfo | null;
  onClose: () => void;
  onSave: (id: string, metadata: VoiceprintMetadata) => Promise<void>;
}

export function VoiceprintEditDialog({
  open,
  voiceprint,
  onClose,
  onSave,
}: VoiceprintEditDialogProps) {
  const { t } = useTranslation("settings");
  const [name, setName] = useState("");
  const [nickname, setNickname] = useState("");
  const [email, setEmail] = useState("");
  const [department, setDepartment] = useState("");
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (voiceprint) {
      setName(voiceprint.name);
      setNickname(voiceprint.nickname);
      setEmail(voiceprint.email);
      setDepartment(voiceprint.department);
      setTitle(voiceprint.title);
      setNote(voiceprint.note);
    }
  }, [voiceprint]);

  const handleSave = async () => {
    if (!voiceprint) return;
    setSaving(true);
    try {
      await onSave(voiceprint.id, {
        name: name || undefined,
        nickname: nickname || undefined,
        email: email || undefined,
        department: department || undefined,
        title: title || undefined,
        note: note || undefined,
      });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("voiceprint.editTitle")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="space-y-1">
            <label className="text-xs font-medium">{t("voiceprint.name")}</label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("voiceprint.namePlaceholder")}
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium">{t("voiceprint.nickname")}</label>
            <Input
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-medium">{t("voiceprint.department")}</label>
              <Input
                value={department}
                onChange={(e) => setDepartment(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium">{t("voiceprint.titleField")}</label>
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium">{t("voiceprint.email")}</label>
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium">{t("voiceprint.note")}</label>
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t("common:action.cancel")}
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {t("common:action.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
