import { memo } from "react";
import type { Segment } from "../../types";
import { useTranscriptionStore } from "../../stores/transcriptionStore";
import { SpeakerBadge } from "./SpeakerBadge";

const SPEAKER_DOT_COLORS = [
  "bg-blue-500",
  "bg-purple-500",
  "bg-cyan-500",
  "bg-green-500",
  "bg-orange-500",
  "bg-pink-500",
  "bg-yellow-500",
  "bg-lime-500",
];

function getSpeakerColorIndex(speaker: string): number {
  return (
    speaker.split("").reduce((acc, c) => acc + c.charCodeAt(0), 0) %
    SPEAKER_DOT_COLORS.length
  );
}

interface SegmentItemProps {
  segment: Segment;
  showSpeakerHeader?: boolean;
  speakerTimeRange?: { start: number; end: number };
  onRenameSpeaker?: (oldName: string, newName: string) => void;
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export const SegmentItem = memo(function SegmentItem({
  segment,
  showSpeakerHeader,
  speakerTimeRange,
  onRenameSpeaker,
}: SegmentItemProps) {
  const seekTo = useTranscriptionStore((s) => s.seekTo);

  return (
    <div>
      {showSpeakerHeader && segment.speaker && speakerTimeRange && (
        <div className="mt-3 mb-1 flex items-center gap-2 rounded-t-md border border-border bg-muted/50 px-3 py-1.5 first:mt-0">
          <span
            className={`inline-block h-2.5 w-2.5 rounded-full ${SPEAKER_DOT_COLORS[getSpeakerColorIndex(segment.speaker)]}`}
          />
          <span className="text-sm font-semibold">{segment.speaker}</span>
          <span className="ml-auto text-xs text-muted-foreground">
            {formatTime(speakerTimeRange.start)} - {formatTime(speakerTimeRange.end)}
          </span>
        </div>
      )}
      <div className="flex items-start gap-2 py-1.5">
        <button
          className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground hover:bg-accent"
          onClick={() => seekTo(segment.start)}
        >
          {formatTime(segment.start)}
        </button>
        {segment.speaker && !showSpeakerHeader && (
          <SpeakerBadge speaker={segment.speaker} onRename={onRenameSpeaker} />
        )}
        <span className="flex-1 leading-relaxed">{segment.text}</span>
      </div>
    </div>
  );
});
