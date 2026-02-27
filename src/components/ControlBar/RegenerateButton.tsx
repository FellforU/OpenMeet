import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, Sparkles, FileText } from "lucide-react";
import { toast } from "sonner";
import { Button } from "../ui/button";
import { useTranscriptionStore } from "../../stores/transcriptionStore";
import { useProjectStore } from "../../stores/projectStore";
import { useEngineStore } from "../../stores/engineStore";
import { useRecordingStore } from "../../stores/recordingStore";
import { generateMeetingSummary } from "../../services/llmClient";

export function RegenerateButton() {
  const { t } = useTranslation("workspace");
  const segments = useTranscriptionStore((s) => s.segments);
  const summary = useTranscriptionStore((s) => s.summary);
  const audioFilePath = useTranscriptionStore((s) => s.audio.filePath);
  const jobStatus = useTranscriptionStore((s) => s.job.status);
  const startTranscription = useTranscriptionStore((s) => s.startTranscription);
  const setSummary = useTranscriptionStore((s) => s.setSummary);
  const persistSummary = useTranscriptionStore((s) => s.persistSummary);
  const activeProjectId = useProjectStore((s) => s.activeProjectId);
  const recordingStatus = useRecordingStore((s) => s.status);
  const processingStep = useRecordingStore((s) => s.processingStep);
  const { selectedEngine, selectedModelSize, selectedLanguage } = useEngineStore();

  const [generating, setGenerating] = useState<"summary" | "transcript" | null>(null);

  const isJobBusy = jobStatus === "running" || jobStatus === "post_processing";
  const isRecording = recordingStatus !== "idle";
  const isProcessing = processingStep !== null;
  const isBusy = isJobBusy || isRecording || isProcessing || generating !== null;

  const hasAudio = Boolean(audioFilePath);
  const hasSegments = segments.length > 0;
  const hasSummary = summary !== null;

  // Show "Generate Summary" when we have segments but no summary
  const needsSummary = hasSegments && !hasSummary;
  // Show "Generate Transcript" when we have audio but no segments
  const needsTranscript = hasAudio && !hasSegments;

  if (!needsSummary && !needsTranscript) {
    return null;
  }

  const handleGenerateSummary = async () => {
    if (!activeProjectId) return;
    setGenerating("summary");
    try {
      const transcriptText = segments
        .map((s) => (s.speaker ? `[${s.speaker}] ${s.text}` : s.text))
        .join("\n");
      const result = await generateMeetingSummary(transcriptText);
      setSummary(result);
      await persistSummary(activeProjectId);
      toast.success(t("common:toast.summarySaved"));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(t("common:error.summaryFailed", { message: msg }));
    } finally {
      setGenerating(null);
    }
  };

  const handleGenerateTranscript = async () => {
    if (!audioFilePath) return;
    setGenerating("transcript");
    try {
      const lang = selectedLanguage === "auto" ? null : selectedLanguage;
      await startTranscription(selectedEngine, selectedModelSize, lang);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(msg);
    } finally {
      setGenerating(null);
    }
  };

  if (needsTranscript) {
    return (
      <Button
        variant="outline"
        size="sm"
        disabled={isBusy}
        onClick={handleGenerateTranscript}
      >
        {generating === "transcript" ? (
          <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
        ) : (
          <FileText className="mr-1.5 h-4 w-4" />
        )}
        {generating === "transcript"
          ? t("regenerate.transcriptGenerating")
          : t("regenerate.transcript")}
      </Button>
    );
  }

  return (
    <Button
      variant="outline"
      size="sm"
      disabled={isBusy}
      onClick={handleGenerateSummary}
    >
      {generating === "summary" ? (
        <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
      ) : (
        <Sparkles className="mr-1.5 h-4 w-4" />
      )}
      {generating === "summary"
        ? t("regenerate.summaryGenerating")
        : t("regenerate.summary")}
    </Button>
  );
}
