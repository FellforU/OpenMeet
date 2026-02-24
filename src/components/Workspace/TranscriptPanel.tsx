import { Empty } from "antd";
import { SegmentItem } from "./SegmentItem";
import { useTranscriptionStore } from "../../stores/transcriptionStore";

export function TranscriptPanel() {
  const segments = useTranscriptionStore((s) => s.segments);
  const status = useTranscriptionStore((s) => s.job.status);

  if (segments.length === 0 && status === "idle") {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%" }}>
        <Empty description="Upload audio or start recording to begin transcription" />
      </div>
    );
  }

  return (
    <div style={{ padding: 16, overflowY: "auto", height: "100%" }}>
      {segments.map((seg) => (
        <SegmentItem key={seg.id} segment={seg} />
      ))}
      {status === "running" && (
        <div style={{ padding: 8, color: "#999", fontSize: 12 }}>
          Transcribing...
        </div>
      )}
    </div>
  );
}
