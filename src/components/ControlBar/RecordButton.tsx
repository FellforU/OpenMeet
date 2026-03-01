import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Mic, Pause, Square, Loader2, ChevronDown, Monitor } from "lucide-react";
import { toast } from "sonner";
import { Button } from "../ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { useRecordingStore } from "../../stores/recordingStore";
import { useEngineStore } from "../../stores/engineStore";
import type { AudioSource } from "../../stores/recordingStore";

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

const STEP_LABEL_MAP: Record<string, string> = {
  saving: "processing.saving",
  merging: "processing.merging",
  loading: "processing.loading",
  titling: "processing.titling",
  summarizing: "processing.summarizing",
};

export function RecordButton() {
  const { t } = useTranslation();
  const { status, elapsed, processingStep, audioSource, setAudioSource, startRecording, pauseRecording, resumeRecording, stopRecording } =
    useRecordingStore();
  const { selectedEngine, selectedModelSize, selectedLanguage } =
    useEngineStore();
  const [starting, setStarting] = useState(false);

  const handleStart = async () => {
    const lang = selectedLanguage === "auto" ? null : selectedLanguage;
    setStarting(true);
    try {
      await startRecording(selectedEngine, selectedModelSize, lang);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(t("error.recordingFailed", { message: msg }));
    } finally {
      setStarting(false);
    }
  };

  // Show processing indicator after recording stops
  if (processingStep) {
    return (
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" disabled>
          <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
          {t(STEP_LABEL_MAP[processingStep] || "status.processing")}
        </Button>
      </div>
    );
  }

  if (status === "idle") {
    return (
      <div className="flex items-center">
        <Button
          variant="outline"
          size="sm"
          className="rounded-r-none"
          onClick={handleStart}
          disabled={starting}
        >
          {audioSource === "system" ? (
            <Monitor className="mr-1.5 h-4 w-4" />
          ) : audioSource === "mixed" ? (
            <>
              <Mic className="mr-0.5 h-4 w-4" />
              <Monitor className="mr-1.5 h-4 w-4" />
            </>
          ) : (
            <Mic className="mr-1.5 h-4 w-4" />
          )}
          {starting ? t("action.starting") : t("action.record")}
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="rounded-l-none border-l-0 px-1.5"
              disabled={starting}
            >
              <ChevronDown className="h-3.5 w-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuRadioGroup
              value={audioSource}
              onValueChange={(v) => setAudioSource(v as AudioSource)}
            >
              <DropdownMenuRadioItem value="microphone">
                <Mic className="mr-2 h-4 w-4" />
                {t("recording.microphone")}
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="system">
                <Monitor className="mr-2 h-4 w-4" />
                {t("recording.systemAudio")}
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="mixed">
                <Mic className="mr-2 h-4 w-4" />
                <Monitor className="mr-2 h-4 w-4 -ml-2" />
                {t("recording.mixed")}
              </DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1">
      {status === "recording" ? (
        <Button variant="outline" size="sm" onClick={pauseRecording}>
          <Pause className="mr-1.5 h-4 w-4" />
          {t("action.pause")}
        </Button>
      ) : (
        <Button variant="outline" size="sm" onClick={resumeRecording}>
          <Mic className="mr-1.5 h-4 w-4" />
          {t("action.resume")}
        </Button>
      )}
      <Button variant="destructive" size="sm" onClick={stopRecording}>
        <Square className="mr-1.5 h-4 w-4" />
        {t("action.stop")}
      </Button>
      <span
        className={`text-xs tabular-nums ${status === "recording" ? "text-destructive" : "text-muted-foreground"}`}
      >
        {status === "recording" ? "● " : "⏸ "}
        {formatElapsed(elapsed)}
      </span>
    </div>
  );
}
