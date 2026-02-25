import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Mic, Loader2 } from "lucide-react";
import { SegmentItem } from "./SegmentItem";
import { useTranscriptionStore } from "../../stores/transcriptionStore";

export function TranscriptPanel() {
  const { t } = useTranslation("workspace");
  const segments = useTranscriptionStore((s) => s.segments);
  const status = useTranscriptionStore((s) => s.job.status);
  const updateSegmentSpeaker = useTranscriptionStore((s) => s.updateSegmentSpeaker);

  // Pre-compute speaker group time ranges
  const speakerRanges = useMemo(() => {
    const ranges = new Map<number, { start: number; end: number }>();
    let groupStart = 0;
    for (let i = 0; i < segments.length; i++) {
      const isNewGroup =
        i === 0 || segments[i].speaker !== segments[i - 1].speaker;
      if (isNewGroup) {
        groupStart = i;
      }
      // Look ahead to find group end
      const isLastInGroup =
        i === segments.length - 1 ||
        segments[i + 1].speaker !== segments[i].speaker;
      if (isLastInGroup) {
        const range = {
          start: segments[groupStart].start,
          end: segments[i].end,
        };
        // Assign range to the group start index
        ranges.set(groupStart, range);
      }
    }
    return ranges;
  }, [segments]);

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
      {segments.map((seg, i) => {
        const showHeader =
          i === 0 || seg.speaker !== segments[i - 1].speaker;
        return (
          <SegmentItem
            key={seg.id}
            segment={seg}
            showSpeakerHeader={showHeader}
            speakerTimeRange={showHeader ? speakerRanges.get(i) : undefined}
            onRenameSpeaker={updateSegmentSpeaker}
          />
        );
      })}
      {status === "running" && (
        <div className="flex items-center gap-2 p-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          {t("transcript.transcribing")}
        </div>
      )}
    </div>
  );
}
