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

interface SpeakerCountPromptProps {
  open: boolean;
  /** 确认或跳过时回调；跳过时 count 为 undefined（自动识别） */
  onSubmit: (count?: number) => void;
}

/** 发言人数量弹窗（展示组件），录音停止和重新后处理流程共用 */
export function SpeakerCountPrompt({ open, onSubmit }: SpeakerCountPromptProps) {
  const { t } = useTranslation("workspace");
  const [value, setValue] = useState("");

  const handleConfirm = () => {
    const num = parseInt(value, 10);
    onSubmit(!isNaN(num) && num >= 1 ? num : undefined);
    setValue("");
  };

  const handleSkip = () => {
    onSubmit(undefined);
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

/** 录音停止流程的包装：状态挂在 recordingStore 上 */
export function SpeakerCountDialog() {
  const open = useRecordingStore((s) => s.showSpeakerCountDialog);
  const confirm = useRecordingStore((s) => s.confirmSpeakerCount);
  return <SpeakerCountPrompt open={open} onSubmit={confirm} />;
}
