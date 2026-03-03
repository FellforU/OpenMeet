import { useState, useMemo, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Mic, Loader2, Pencil, Save, X, Radio } from "lucide-react";
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

export function TranscriptPanel() {
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

  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState("");
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

  const handleStartEdit = () => {
    setEditText(segmentsToMarkdown(segments));
    setEditing(true);
  };

  const setSegments = useTranscriptionStore((s) => s.setSegments);

  const handleSave = () => {
    // Parse edited markdown back to segments, preserving timestamps from originals
    const lines = editText.split("\n").filter((l) => l.trim());
    const newSegments: Segment[] = [];
    let currentSpeaker = "";
    let segIdx = 0;

    for (const line of lines) {
      // Detect speaker header: **SpeakerName:**
      const speakerMatch = line.match(/^\*\*(.+?):\*\*$/);
      if (speakerMatch) {
        currentSpeaker = speakerMatch[1];
        continue;
      }
      // Map to original segment for timestamps, or create new
      const orig = segments[segIdx];
      newSegments.push({
        id: orig?.id ?? `seg-${segIdx}`,
        start: orig?.start ?? 0,
        end: orig?.end ?? 0,
        text: line,
        speaker: currentSpeaker || orig?.speaker || null,
        confidence: orig?.confidence ?? null,
      });
      segIdx++;
    }

    setSegments(newSegments);
    setEditing(false);
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
    setEditing(false);
    setEditText("");
  };

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

  if (editing) {
    return (
      <div className="flex h-full flex-col">
        <div className="flex items-center gap-2 px-4 py-2">
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
        <MilkdownEditor
          defaultValue={editText}
          onChange={(md) => setEditText(md)}
        />
      </div>
    );
  }

  const isProcessing = status === "running" || status === "post_processing";

  // Pipeline step display name
  const stepLabels: Record<string, string> = {
    loading_model: t("transcript.step.loading_model"),
    transcribing: t("transcript.step.transcribing"),
    itn: t("transcript.step.itn"),
    punctuation: t("transcript.step.punctuation"),
    diarizing: t("transcript.step.diarizing"),
    summarizing: t("transcript.step.summarizing"),
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-end px-4 py-2">
        {segments.length > 0 && !isRecording && (
          <Button variant="outline" size="sm" onClick={handleStartEdit}>
            <Pencil className="mr-1.5 h-4 w-4" />
            {t("common:action.edit")}
          </Button>
        )}
      </div>

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
