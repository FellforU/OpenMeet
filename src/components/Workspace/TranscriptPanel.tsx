import { useTranslation } from "react-i18next";
import { Mic, Loader2 } from "lucide-react";
import { SegmentItem } from "./SegmentItem";
import { useTranscriptionStore } from "../../stores/transcriptionStore";

export function TranscriptPanel() {
  const { t } = useTranslation("workspace");
  const segments = useTranscriptionStore((s) => s.segments);
  const status = useTranscriptionStore((s) => s.job.status);

  if (segments.length === 0 && status === "idle") {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
        <Mic className="h-10 w-10" />
        <p className="text-sm">{t("transcript.empty")}</p>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto p-4">
      {segments.map((seg) => (
        <SegmentItem key={seg.id} segment={seg} />
      ))}
      {status === "running" && (
        <div className="flex items-center gap-2 p-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          {t("transcript.transcribing")}
        </div>
      )}
    </div>
  );
}
