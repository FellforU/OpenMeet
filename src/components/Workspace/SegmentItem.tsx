import { memo } from "react";
import { Typography } from "antd";
import type { Segment } from "../../types";
import { useTranscriptionStore } from "../../stores/transcriptionStore";
import { SpeakerBadge } from "./SpeakerBadge";

const { Text } = Typography;

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
    <div style={{ display: "flex", gap: 8, padding: "6px 0", alignItems: "flex-start" }}>
      <Text
        code
        style={{ cursor: "pointer", flexShrink: 0, fontSize: 12 }}
        onClick={() => seekTo(segment.start)}
      >
        {formatTime(segment.start)}
      </Text>
      {segment.speaker && (
        <SpeakerBadge speaker={segment.speaker} onRename={onRenameSpeaker} />
      )}
      <Text style={{ flex: 1, lineHeight: 1.6 }}>{segment.text}</Text>
    </div>
  );
});
