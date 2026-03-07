import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Users } from "lucide-react";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { useRecordingStore } from "../../stores/recordingStore";

export function SpeakerCountDialog() {
  const { t } = useTranslation("workspace");
  const open = useRecordingStore((s) => s.showSpeakerCountDialog);
  const confirm = useRecordingStore((s) => s.confirmSpeakerCount);
  const [value, setValue] = useState("");

  const handleConfirm = () => {
    const num = parseInt(value, 10);
    confirm(!isNaN(num) && num >= 1 ? num : undefined);
    setValue("");
  };

  const handleSkip = () => {
    confirm(undefined);
    setValue("");
  };

  return (
    <Dialog open={open} onOpenChange={() => {}}>
      <DialogContent
        className="sm:max-w-sm"
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            {t("speakerCount.title")}
          </DialogTitle>
          <DialogDescription>
            {t("speakerCount.description")}
          </DialogDescription>
        </DialogHeader>
        <div className="py-4">
          <input
            type="number"
            min="1"
            max="20"
            placeholder={t("speakerCount.placeholder")}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleConfirm();
            }}
            autoFocus
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={handleSkip}>
            {t("speakerCount.skip")}
          </Button>
          <Button onClick={handleConfirm}>
            {t("speakerCount.confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
