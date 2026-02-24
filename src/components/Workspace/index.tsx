import { TranscriptPanel } from "./TranscriptPanel";

export function Workspace() {
  return (
    <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
      <div style={{ flex: 1, overflow: "auto", borderRight: "1px solid #f0f0f0" }}>
        <TranscriptPanel />
      </div>
      {/* SummaryPanel will be added in Phase 3 */}
    </div>
  );
}
