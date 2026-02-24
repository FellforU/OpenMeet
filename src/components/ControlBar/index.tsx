import { AudioPlayer } from "./AudioPlayer";
import { ActionButtons } from "./ActionButtons";

export function ControlBar() {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 16,
        padding: "8px 16px",
        borderTop: "1px solid #f0f0f0",
        background: "#fff",
      }}
    >
      <AudioPlayer />
      <ActionButtons />
    </div>
  );
}
