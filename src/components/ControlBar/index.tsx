import { AudioPlayer } from "./AudioPlayer";
import { ActionButtons } from "./ActionButtons";
import { RegenerateButton } from "./RegenerateButton";
import { SpeakerCountDialog } from "./SpeakerCountDialog";

export function ControlBar() {
  return (
    <div className="flex items-center gap-4 border-t border-border bg-card px-4 py-2">
      <AudioPlayer />
      <ActionButtons />
      <RegenerateButton />
      <SpeakerCountDialog />
    </div>
  );
}
