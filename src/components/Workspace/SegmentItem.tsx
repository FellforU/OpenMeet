import { memo } from "react";
import type { Segment } from "../../types";
import { useTranscriptionStore } from "../../stores/transcriptionStore";
import { SpeakerBadge } from "./SpeakerBadge";

interface SegmentItemProps {
  segment: Segment;
  onRenameSpeaker?: (oldName: string, newName: string) => void;
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export const SegmentItem = memo(function SegmentItem({ segment, onRenameSpeaker }: SegmentItemProps) {
  const seekTo = useTranscriptionStore((s) => s.seekTo);

  return (
    <div className="flex items-start gap-2 py-1.5">
      <button
        className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground hover:bg-accent"
        onClick={() => seekTo(segment.start)}
      >
        {formatTime(segment.start)}
      </button>
      {segment.speaker && (
        <SpeakerBadge speaker={segment.speaker} onRename={onRenameSpeaker} />
      )}
      <span className="flex-1 leading-relaxed">{segment.text}</span>
    </div>
  );
});
