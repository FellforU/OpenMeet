import { AudioPlayer } from "./AudioPlayer";
import { ActionButtons } from "./ActionButtons";
import { RegenerateButton } from "./RegenerateButton";

export function ControlBar() {
  return (
    <div className="flex items-center gap-4 border-t border-border bg-card px-4 py-2">
      <AudioPlayer />
      <ActionButtons />
      <RegenerateButton />
    </div>
  );
}
