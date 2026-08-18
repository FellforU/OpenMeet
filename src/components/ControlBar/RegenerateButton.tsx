import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, Sparkles, FileText, RefreshCw, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "../ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { SpeakerCountPrompt } from "./SpeakerCountDialog";
import { invoke } from "@tauri-apps/api/core";
import { useTranscriptionStore } from "../../stores/transcriptionStore";
import { useProjectStore } from "../../stores/projectStore";
import { useEngineStore } from "../../stores/engineStore";
import { useRecordingStore } from "../../stores/recordingStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { generateMeetingSummary } from "../../services/llmClient";
import { reprocessSegments, getJob, getJobResult } from "../../services/asrClient";
import type { JobStatus, PipelineStep, Segment, VoiceprintMatchResult } from "../../types";

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
  const [speakerPromptOpen, setSpeakerPromptOpen] = useState(false);

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

  const handleReprocess = async (numSpeakers?: number) => {
    if (segments.length === 0) return;
    setGenerating("postprocess");

    // 把后处理进度同步到 store，转录页的进度框会显示当前步骤
    const setJobState = (patch: { status?: JobStatus; pipelineStep?: PipelineStep }) =>
      useTranscriptionStore.setState((s) => ({ job: { ...s.job, ...patch } }));

    try {
      // numSpeakers 来自弹窗输入；跳过时为 undefined，由模型自动识别
      const { job_id: reprocessJobId } = await reprocessSegments({
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

      // 轮询进度直到完成（上限 30 分钟）
      setJobState({ status: "post_processing", pipelineStep: null });
      let jobError: string | null = null;
      for (let i = 0; i < 1800; i++) {
        await new Promise((r) => setTimeout(r, 1000));
        const jobResp = await getJob(reprocessJobId);
        setJobState({
          pipelineStep: (jobResp.pipeline_step as PipelineStep) ?? null,
        });
        if (jobResp.status === "ready" || jobResp.status === "completed") {
          jobError = jobResp.error;
          break;
        }
        if (jobResp.status === "cancelled") {
          throw new Error(jobResp.error || "post-processing cancelled");
        }
      }
      if (jobError) {
        throw new Error(jobError);
      }

      const result = await getJobResult(reprocessJobId);

      const newSegments: Segment[] = result.segments.map((s) => ({
        id: crypto.randomUUID(),
        start: s.start,
        end: s.end,
        text: s.text,
        speaker: s.speaker ?? null,
        confidence: s.confidence ?? null,
      }));

      // Voiceprint matching with returned embeddings.
      // 先按说话人聚合，避免逐段 embedding 波动导致聚出大量"未知说话人"
      const { aggregateEmbeddingsBySpeaker } = await import("../../services/embeddingUtils");
      const rawEmbeddings: (number[] | null)[] = result.embeddings || [];
      const embeddings = aggregateEmbeddingsBySpeaker(newSegments, rawEmbeddings);
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

      // 摘要为空且开启了自动摘要时，重处理后顺带补生成一次
      const hasSummary = Boolean(useTranscriptionStore.getState().summary);
      const autoSummary = useSettingsStore.getState().general.autoSummary;
      if (!hasSummary && autoSummary && activeProjectId && newSegments.length > 0) {
        try {
          const transcriptText = newSegments
            .map((s) => (s.speaker ? `[${s.speaker}] ${s.text}` : s.text))
            .join("\n");
          const summaryResult = await generateMeetingSummary(transcriptText);
          setSummary(summaryResult);
          await persistSummary(activeProjectId);
        } catch {
          toast.warning(t("common:error.summaryFailed", { message: "" }));
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(t("regenerate.postProcessFailed", { message: msg }));
    } finally {
      setJobState({ status: "idle", pipelineStep: null });
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
    <>
      {/* 点击"重新后处理"先弹发言人数量确认，跳过则自动识别 */}
      <SpeakerCountPrompt
        open={speakerPromptOpen}
        onSubmit={(count) => {
          setSpeakerPromptOpen(false);
          void handleReprocess(count);
        }}
      />
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
          <DropdownMenuItem onClick={() => setSpeakerPromptOpen(true)}>
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
      </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
