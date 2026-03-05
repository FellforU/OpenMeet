import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, Sparkles, FileText, RefreshCw, Wand2, MessageSquareText } from "lucide-react";
import { toast } from "sonner";
import { Button } from "../ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { useTranscriptionStore } from "../../stores/transcriptionStore";
import { useProjectStore } from "../../stores/projectStore";
import { useEngineStore } from "../../stores/engineStore";
import { useRecordingStore } from "../../stores/recordingStore";
import { generateMeetingSummary, correctTranscriptErrors } from "../../services/llmClient";
import { reprocessSegments } from "../../services/asrClient";

export function RegenerateButton() {
  const { t } = useTranslation("workspace");
  const segments = useTranscriptionStore((s) => s.segments);
  const audioFilePath = useTranscriptionStore((s) => s.audio.filePath);
  const jobStatus = useTranscriptionStore((s) => s.job.status);
  const startTranscription = useTranscriptionStore((s) => s.startTranscription);
  const setSummary = useTranscriptionStore((s) => s.setSummary);
  const setSegments = useTranscriptionStore((s) => s.setSegments);
  const persistSummary = useTranscriptionStore((s) => s.persistSummary);
  const persistSegments = useTranscriptionStore((s) => s.persistSegments);
  const activeProjectId = useProjectStore((s) => s.activeProjectId);
  const recordingStatus = useRecordingStore((s) => s.status);
  const processingStep = useRecordingStore((s) => s.processingStep);
  const { selectedEngine, selectedModelSize, selectedLanguage } = useEngineStore();

  const [generating, setGenerating] = useState<"summary" | "transcript" | "postprocess" | "correction" | null>(null);

  const isJobBusy = jobStatus === "running" || jobStatus === "post_processing";
  const isRecording = recordingStatus !== "idle";
  const isProcessing = processingStep !== null;
  const isBusy = isJobBusy || isRecording || isProcessing || generating !== null;

  const hasAudio = Boolean(audioFilePath);
  const hasSegments = segments.length > 0;

  // Nothing to regenerate
  if (!hasAudio && !hasSegments) {
    return null;
  }

  const handleGenerateSummary = async () => {
    if (!activeProjectId || segments.length === 0) return;
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

  const handleReprocess = async () => {
    if (segments.length === 0) return;
    setGenerating("postprocess");
    try {
      const result = await reprocessSegments({
        segments: segments.map((s) => ({
          start: s.start,
          end: s.end,
          text: s.text,
          speaker: s.speaker || null,
          confidence: s.confidence ?? null,
        })),
        audio_path: audioFilePath || undefined,
        engine: selectedEngine,
        language: selectedLanguage === "auto" ? undefined : selectedLanguage,
      });

      const newSegments = result.segments.map((s) => ({
        id: crypto.randomUUID(),
        start: s.start,
        end: s.end,
        text: s.text,
        speaker: s.speaker ?? null,
        confidence: s.confidence ?? null,
      }));

      setSegments(newSegments);

      if (activeProjectId) {
        await persistSegments(activeProjectId);
      }

      toast.success(t("regenerate.postProcessSuccess"));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(t("regenerate.postProcessFailed", { message: msg }));
    } finally {
      setGenerating(null);
    }
  };

  const handleCorrection = async () => {
    if (segments.length === 0) return;
    setGenerating("correction");
    try {
      const correctedTexts = await correctTranscriptErrors(
        segments.map((s) => ({ text: s.text }))
      );

      const newSegments = segments.map((s, i) => ({
        ...s,
        text: correctedTexts[i] ?? s.text,
      }));

      setSegments(newSegments);

      if (activeProjectId) {
        await persistSegments(activeProjectId);
      }

      toast.success(t("regenerate.correctionSuccess"));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(t("regenerate.correctionFailed", { message: msg }));
    } finally {
      setGenerating(null);
    }
  };

  // Show spinner when generating
  if (generating) {
    const labelKey =
      generating === "summary"
        ? "regenerate.summaryGenerating"
        : generating === "postprocess"
          ? "regenerate.postProcessing"
          : generating === "correction"
            ? "regenerate.correctionRunning"
            : "regenerate.transcriptGenerating";
    return (
      <Button variant="outline" size="sm" disabled>
        <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
        {t(labelKey)}
      </Button>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" disabled={isBusy}>
          <RefreshCw className="mr-1.5 h-4 w-4" />
          {t("regenerate.title")}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        {hasAudio && (
          <DropdownMenuItem onClick={handleGenerateTranscript}>
            <FileText className="mr-2 h-4 w-4" />
            {t("regenerate.transcript")}
          </DropdownMenuItem>
        )}
        {hasSegments && (
          <DropdownMenuItem onClick={handleReprocess}>
            <Wand2 className="mr-2 h-4 w-4" />
            {t("regenerate.postProcess")}
          </DropdownMenuItem>
        )}
        {hasSegments && (
          <DropdownMenuItem onClick={handleCorrection}>
            <MessageSquareText className="mr-2 h-4 w-4" />
            {t("regenerate.correction")}
          </DropdownMenuItem>
        )}
        {hasSegments && (
          <DropdownMenuItem onClick={handleGenerateSummary}>
            <Sparkles className="mr-2 h-4 w-4" />
            {t("regenerate.summary")}
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
