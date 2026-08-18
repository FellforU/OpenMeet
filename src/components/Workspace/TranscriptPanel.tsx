import { useState, useMemo, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Mic, Loader2, Save, X, Radio } from "lucide-react";
import { toast } from "sonner";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";
import { SegmentItem } from "./SegmentItem";
import { MilkdownEditor } from "../Editor";
import { useTranscriptionStore } from "../../stores/transcriptionStore";
import { useRecordingStore } from "../../stores/recordingStore";
import { useProjectStore } from "../../stores/projectStore";
import type { Segment } from "../../types";

function segmentsToMarkdown(segments: Segment[]): string {
  const lines: string[] = [];
  let lastSpeaker = "";
  for (const seg of segments) {
    if (seg.speaker && seg.speaker !== lastSpeaker) {
      if (lines.length > 0) lines.push("");
      lines.push(`**${seg.speaker}:**`);
      lastSpeaker = seg.speaker;
    }
    lines.push(seg.text);
  }
  return lines.join("\n");
}

interface TranscriptPanelProps {
  /** 编辑状态由 Workspace 托管，编辑按钮显示在标签页行的导出按钮旁 */
  editing?: boolean;
  onEditingChange?: (editing: boolean) => void;
}

export function TranscriptPanel({
  editing = false,
  onEditingChange,
}: TranscriptPanelProps) {
  const { t } = useTranslation("workspace");
  const segments = useTranscriptionStore((s) => s.segments);
  const status = useTranscriptionStore((s) => s.job.status);
  const pipelineStep = useTranscriptionStore((s) => s.job.pipelineStep);
  const progress = useTranscriptionStore((s) => s.job.progress);
  const highlightSegmentTime = useTranscriptionStore((s) => s.highlightSegmentTime);
  const clearHighlight = useTranscriptionStore((s) => s.clearHighlight);
  const updateSegmentSpeaker = useTranscriptionStore((s) => s.updateSegmentSpeaker);
  const assignSegmentVoiceprint = useTranscriptionStore((s) => s.assignSegmentVoiceprint);

  const isRecording = useRecordingStore((s) => s.status === "recording");

  const [editInitialText, setEditInitialText] = useState("");
  const editTextRef = useRef("");
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Scroll to and highlight segment when highlightSegmentTime changes
  useEffect(() => {
    if (highlightSegmentTime === null || segments.length === 0) return;

    // Find the segment closest to the target time
    let bestSeg: Segment | null = null;
    let bestDist = Infinity;
    for (const seg of segments) {
      const dist = Math.abs(seg.start - highlightSegmentTime);
      if (dist < bestDist) {
        bestDist = dist;
        bestSeg = seg;
      }
    }

    if (!bestSeg) return;

    setHighlightedId(bestSeg.id);

    // Scroll to the segment element
    requestAnimationFrame(() => {
      const el = scrollContainerRef.current?.querySelector(
        `[data-segment-id="${bestSeg!.id}"]`
      );
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    });

    // Clear highlight after 3 seconds
    const timer = setTimeout(() => {
      setHighlightedId(null);
      clearHighlight();
    }, 3000);

    return () => clearTimeout(timer);
  }, [highlightSegmentTime, segments, clearHighlight]);

  // Auto-scroll to bottom during recording when new segments arrive
  useEffect(() => {
    if (!isRecording || segments.length === 0) return;
    const container = scrollContainerRef.current;
    if (!container) return;
    // Only auto-scroll if user is near the bottom (within 100px)
    const isNearBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight < 100;
    if (isNearBottom) {
      // Use rAF to ensure the new segment's DOM node is rendered first
      requestAnimationFrame(() => {
        container.scrollTop = container.scrollHeight;
      });
    }
  }, [segments.length, isRecording]);

  const speakerRanges = useMemo(() => {
    const ranges = new Map<number, { start: number; end: number }>();
    let groupStart = 0;
    for (let i = 0; i < segments.length; i++) {
      const isNewGroup = i === 0 || segments[i].speaker !== segments[i - 1].speaker;
      if (isNewGroup) groupStart = i;
      const isLastInGroup =
        i === segments.length - 1 || segments[i + 1].speaker !== segments[i].speaker;
      if (isLastInGroup) {
        ranges.set(groupStart, {
          start: segments[groupStart].start,
          end: segments[i].end,
        });
      }
    }
    return ranges;
  }, [segments]);

  // 进入编辑模式时初始化编辑内容
  useEffect(() => {
    if (editing) {
      const md = segmentsToMarkdown(segments);
      editTextRef.current = md;
      setEditInitialText(md);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);

  const setSegments = useTranscriptionStore((s) => s.setSegments);

  const handleSave = () => {
    // Parse edited markdown back to segments, preserving timestamps from originals
    const lines = editTextRef.current.split("\n");
    const newSegments: Segment[] = [];
    let currentSpeaker = "";
    let segIdx = 0;

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      // Detect speaker header: line is ONLY bold text, optionally followed by colon
      // Matches: **Name:**  **Name：**  **Name**:  **Name**：  **Name**
      const speakerMatch = trimmed.match(/^\*\*(.+?)\*\*\s*[:：]?\s*$/);
      if (speakerMatch) {
        const name = speakerMatch[1].replace(/[:：\s]+$/, "").trim();
        if (name) {
          currentSpeaker = name;
          continue;
        }
      }

      // Map to original segment for timestamps, or create new
      const orig = segIdx < segments.length ? segments[segIdx] : null;
      newSegments.push({
        id: orig?.id ?? crypto.randomUUID(),
        start: orig?.start ?? 0,
        end: orig?.end ?? 0,
        text: trimmed,
        speaker: currentSpeaker || orig?.speaker || null,
        confidence: orig?.confidence ?? null,
      });
      segIdx++;
    }

    if (newSegments.length === 0) {
      toast.error(t("common:toast.emptyTranscript", "转录内容为空"));
      return;
    }

    setSegments(newSegments);
    onEditingChange?.(false);
    toast.success(t("common:toast.transcriptSaved"));

    // Persist to SQLite
    const activeProjectId = useProjectStore.getState().activeProjectId;
    if (activeProjectId) {
      useTranscriptionStore
        .getState()
        .persistSegments(activeProjectId)
        .catch((err) => {
          console.error("Failed to persist segments:", err);
          toast.error(t("common:toast.persistFailed"));
        });
    }
  };

  const handleCancel = () => {
    onEditingChange?.(false);
    editTextRef.current = "";
  };

  // Editing mode takes priority — never lose user's edit state
  if (editing) {
    return (
      <div className="flex h-full flex-col overflow-hidden">
        <div className="sticky top-0 z-10 flex shrink-0 items-center gap-2 border-b bg-background px-4 py-2">
          <Badge variant="secondary">{t("transcript.editMode")}</Badge>
          <div className="ml-auto flex gap-2">
            <Button size="sm" onClick={handleSave}>
              <Save className="mr-1.5 h-4 w-4" />
              {t("common:action.save")}
            </Button>
            <Button variant="outline" size="sm" onClick={handleCancel}>
              <X className="mr-1.5 h-4 w-4" />
              {t("common:action.cancel")}
            </Button>
          </div>
        </div>
        <div className="min-h-0 flex-1">
          <MilkdownEditor
            defaultValue={editInitialText}
            onChange={(md) => { editTextRef.current = md; }}
          />
        </div>
      </div>
    );
  }

  // Empty state: recording but no segments yet
  if (segments.length === 0 && isRecording) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
        <div className="relative">
          <Mic className="h-10 w-10" />
          <span className="absolute -right-1 -top-1 h-3 w-3 animate-pulse rounded-full bg-red-500" />
        </div>
        <p className="text-sm">{t("transcript.waitingForSegments")}</p>
      </div>
    );
  }

  // Empty state: idle with no segments
  if (segments.length === 0 && status === "idle") {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
        <Mic className="h-10 w-10" />
        <p className="text-sm">{t("transcript.empty")}</p>
      </div>
    );
  }

  const isProcessing = status === "running" || status === "post_processing";

  // Pipeline step display name
  const stepLabels: Record<string, string> = {
    loading_model: t("transcript.step.loading_model"),
    transcribing: t("transcript.step.transcribing"),
    hallucination: t("transcript.step.hallucination"),
    itn: t("transcript.step.itn"),
    filler: t("transcript.step.filler"),
    llm_correction: t("transcript.step.llm_correction"),
    segmentation: t("transcript.step.segmentation"),
    punctuation: t("transcript.step.punctuation"),
    diarizing: t("transcript.step.diarizing"),
    embedding: t("transcript.step.embedding"),
    summarizing: t("transcript.step.summarizing"),
  };

  return (
    <div className="flex h-full flex-col pt-2">
      {/* Prominent progress display when transcription is running */}
      {isProcessing && (
        <div className="mx-4 mb-3 flex flex-col items-center gap-3 rounded-lg border border-blue-200 bg-blue-50/50 p-6 dark:border-blue-900 dark:bg-blue-950/30">
          <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
          <div className="text-center">
            <p className="text-lg font-medium text-blue-700 dark:text-blue-300">
              {pipelineStep ? stepLabels[pipelineStep] || t("transcript.processing") : t("transcript.processing")}
            </p>
            {status === "running" && progress > 0 && (
              <p className="mt-1 text-sm text-blue-600/80 dark:text-blue-400/80">
                {Math.round(progress)}%
              </p>
            )}
          </div>
          {status === "running" && (
            <div className="h-1.5 w-48 overflow-hidden rounded-full bg-blue-200 dark:bg-blue-900">
              <div
                className="h-full rounded-full bg-blue-500 transition-all duration-500"
                style={{ width: `${Math.max(2, Math.round(progress))}%` }}
              />
            </div>
          )}
        </div>
      )}

      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto px-4">
        {segments.map((seg, i) => {
          const showHeader = i === 0 || seg.speaker !== segments[i - 1].speaker;
          return (
            <div
              key={seg.id}
              data-segment-id={seg.id}
              className={
                highlightedId === seg.id
                  ? "rounded-md bg-yellow-100 transition-colors duration-300 dark:bg-yellow-900/30"
                  : "transition-colors duration-300"
              }
            >
              <SegmentItem
                segment={seg}
                showSpeakerHeader={showHeader}
                speakerTimeRange={showHeader ? speakerRanges.get(i) : undefined}
                onRenameSpeaker={updateSegmentSpeaker}
                onAssignVoiceprint={assignSegmentVoiceprint}
              />
            </div>
          );
        })}
        {isProcessing && segments.length > 0 && (
          <div className="flex items-center gap-2 p-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            {t("transcript.transcribing")}
          </div>
        )}
      </div>

      {/* Live recording indicator at the bottom */}
      {isRecording && segments.length > 0 && (
        <div className="flex items-center gap-2 border-t px-4 py-2 text-xs text-red-600 dark:text-red-400">
          <Radio className="h-3.5 w-3.5 animate-pulse" />
          {t("transcript.liveRecording")}
        </div>
      )}
    </div>
  );
}
