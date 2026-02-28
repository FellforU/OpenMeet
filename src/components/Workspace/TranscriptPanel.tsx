import { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Mic, Loader2, Pencil, Save, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";
import { SegmentItem } from "./SegmentItem";
import { MilkdownEditor } from "../Editor";
import { useTranscriptionStore } from "../../stores/transcriptionStore";
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
  const updateSegmentSpeaker = useTranscriptionStore((s) => s.updateSegmentSpeaker);

  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState("");

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

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-end px-4 py-2">
        {segments.length > 0 && (
          <Button variant="outline" size="sm" onClick={handleStartEdit}>
            <Pencil className="mr-1.5 h-4 w-4" />
            {t("common:action.edit")}
          </Button>
        )}
      </div>
      <div className="flex-1 overflow-y-auto px-4">
        {segments.map((seg, i) => {
          const showHeader = i === 0 || seg.speaker !== segments[i - 1].speaker;
          return (
            <SegmentItem
              key={seg.id}
              segment={seg}
              showSpeakerHeader={showHeader}
              speakerTimeRange={showHeader ? speakerRanges.get(i) : undefined}
              onRenameSpeaker={updateSegmentSpeaker}
            />
          );
        })}
        {status === "running" && (
          <div className="flex items-center gap-2 p-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            {t("transcript.transcribing")}
          </div>
        )}
      </div>
    </div>
  );
}
