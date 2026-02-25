import { AudioPlayer } from "./AudioPlayer";
import { ActionButtons } from "./ActionButtons";
import { ExportButton } from "../Workspace/ExportButton";

export function ControlBar() {
  return (
    <div className="flex items-center gap-4 border-t border-border bg-card px-4 py-2">
      <AudioPlayer />
      <ActionButtons />
      <ExportButton />
    </div>
  );
}
