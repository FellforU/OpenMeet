import { useTranslation } from "react-i18next";
import { Mic, Pause, Square } from "lucide-react";
import { Button } from "../ui/button";
import { useRecordingStore } from "../../stores/recordingStore";
import { useEngineStore } from "../../stores/engineStore";

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function RecordButton() {
  const { t } = useTranslation();
  const { status, elapsed, startRecording, pauseRecording, resumeRecording, stopRecording } =
    useRecordingStore();
  const { selectedEngine, selectedModelSize, selectedLanguage } =
    useEngineStore();

  const handleStart = () => {
    const lang = selectedLanguage === "auto" ? null : selectedLanguage;
    startRecording(selectedEngine, selectedModelSize, lang);
  };

  if (status === "idle") {
    return (
      <Button variant="outline" size="sm" onClick={handleStart}>
        <Mic className="mr-1.5 h-4 w-4" />
        {t("action.record")}
      </Button>
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
