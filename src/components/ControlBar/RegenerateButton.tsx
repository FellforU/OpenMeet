import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, Sparkles, FileText, RefreshCw, Wand2, Users } from "lucide-react";
import { toast } from "sonner";
import { Button } from "../ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from "../ui/dropdown-menu";
import { invoke } from "@tauri-apps/api/core";
import { useTranscriptionStore } from "../../stores/transcriptionStore";
import { useProjectStore } from "../../stores/projectStore";
import { useEngineStore } from "../../stores/engineStore";
import { useRecordingStore } from "../../stores/recordingStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { generateMeetingSummary } from "../../services/llmClient";
import { reprocessSegments } from "../../services/asrClient";
import type { Segment, VoiceprintMatchResult } from "../../types";

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

  const [generating, setGenerating] = useState<"summary" | "transcript" | "postprocess" | null>(null);
  const [numSpeakersInput, setNumSpeakersInput] = useState<string>("");

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
      // Use user-specified speaker count, or auto-detect from unique speakers
      const userNumSpeakers = numSpeakersInput ? parseInt(numSpeakersInput, 10) : NaN;
      let numSpeakers: number | undefined;
      if (!isNaN(userNumSpeakers) && userNumSpeakers >= 1) {
        numSpeakers = userNumSpeakers;
      } else {
        const uniqueSpeakers = new Set(
          segments.map((s) => s.speaker).filter(Boolean)
        );
        numSpeakers = uniqueSpeakers.size >= 2 ? uniqueSpeakers.size : undefined;
      }

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
        num_speakers: numSpeakers,
      });

      const newSegments: Segment[] = result.segments.map((s) => ({
        id: crypto.randomUUID(),
        start: s.start,
        end: s.end,
        text: s.text,
        speaker: s.speaker ?? null,
        confidence: s.confidence ?? null,
      }));

      // Voiceprint matching with returned embeddings
      const embeddings: (number[] | null)[] = result.embeddings || [];
      const hasRealEmbeddings = embeddings.some((e) => e !== null);
      if (hasRealEmbeddings) {
        try {
          const threshold = useSettingsStore.getState().general.diarizationThreshold;
          const matchResult = await invoke<VoiceprintMatchResult>(
            "voiceprint_match",
            { embeddings, threshold }
          );
          for (let i = 0; i < newSegments.length; i++) {
            if (matchResult.assignments[i]) {
              newSegments[i] = { ...newSegments[i], voiceprintId: matchResult.assignments[i]! };
            }
            if (matchResult.speaker_names[i]) {
              newSegments[i] = { ...newSegments[i], speaker: matchResult.speaker_names[i]! };
            }
          }
        } catch {
          // Voiceprint matching failure is non-fatal
        }
      }

      // Propagate voiceprintId from matched segments to unmatched segments
      // with the same speaker label (e.g. short segments without embeddings)
      const speakerToVoiceprint = new Map<string, string>();
      for (const seg of newSegments) {
        if (seg.speaker && seg.voiceprintId) {
          speakerToVoiceprint.set(seg.speaker, seg.voiceprintId);
        }
      }
      for (let i = 0; i < newSegments.length; i++) {
        if (newSegments[i].speaker && !newSegments[i].voiceprintId) {
          const vpId = speakerToVoiceprint.get(newSegments[i].speaker!);
          if (vpId) {
            newSegments[i] = { ...newSegments[i], voiceprintId: vpId };
          }
        }
      }

      // Auto-create voiceprints for still-unmatched speakers.
      // createVoiceprint deduplicates by name — won't create duplicates.
      const { useVoiceprintStore } = await import("../../stores/voiceprintStore");
      const unmatchedSpeakers = new Set<string>();
      for (const seg of newSegments) {
        if (seg.speaker && !seg.voiceprintId) {
          unmatchedSpeakers.add(seg.speaker);
        }
      }
      for (const speaker of unmatchedSpeakers) {
        try {
          const vp = await useVoiceprintStore.getState().createVoiceprint(speaker);
          for (let i = 0; i < newSegments.length; i++) {
            if (newSegments[i].speaker === speaker && !newSegments[i].voiceprintId) {
              newSegments[i] = { ...newSegments[i], voiceprintId: vp.id };
            }
          }
        } catch {
          // Non-fatal
        }
      }

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

  // Show spinner when generating
  if (generating) {
    const labelKey =
      generating === "summary"
        ? "regenerate.summaryGenerating"
        : generating === "postprocess"
          ? "regenerate.postProcessing"
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
          <DropdownMenuItem onClick={handleGenerateSummary}>
            <Sparkles className="mr-2 h-4 w-4" />
            {t("regenerate.summary")}
          </DropdownMenuItem>
        )}
        {hasSegments && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="flex items-center gap-2 text-xs font-normal text-muted-foreground">
              <Users className="h-3.5 w-3.5" />
              {t("regenerate.numSpeakers")}
            </DropdownMenuLabel>
            <div className="px-2 pb-1.5" onPointerDown={(e) => e.stopPropagation()}>
              <input
                type="number"
                min="1"
                max="20"
                placeholder={t("regenerate.numSpeakersPlaceholder")}
                value={numSpeakersInput}
                onChange={(e) => setNumSpeakersInput(e.target.value)}
                className="w-full rounded-md border border-input bg-background px-2 py-1 text-xs outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
