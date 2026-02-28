import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Lightbulb,
  CheckCircle,
  User,
  Calendar,
  Loader2,
  MessageSquare,
  Pencil,
  Save,
  X,
  Link2,
} from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { MilkdownEditor } from "../Editor";
import { useTranscriptionStore } from "../../stores/transcriptionStore";
import { useProjectStore } from "../../stores/projectStore";
import type { Segment } from "../../types";

interface ActionItem {
  action?: string;
  task?: string;
  assignee?: string;
  owner?: string;
  deadline?: string | null;
  done?: boolean;
}

interface SummaryPanelProps {
  onJumpToTranscript?: (time: number) => void;
}

function findSegmentTime(
  summaryText: string,
  segments: Segment[]
): number | null {
  if (!segments.length) return null;

  // Extract Chinese word groups (2-4 chars) and English words as keywords
  const chineseWords = summaryText.match(/[\u4e00-\u9fa5]{2,4}/g) || [];
  const englishWords =
    summaryText.match(/[a-zA-Z]{3,}/g)?.map((w) => w.toLowerCase()) || [];
  const keywords = [...new Set([...chineseWords, ...englishWords])];
  if (keywords.length === 0) return null;

  let bestScore = 0;
  let bestTime: number | null = null;

  for (const seg of segments) {
    let score = 0;
    const segLower = seg.text.toLowerCase();
    for (const kw of keywords) {
      if (segLower.includes(kw.toLowerCase())) score++;
    }
    if (score > bestScore) {
      bestScore = score;
      bestTime = seg.start;
    }
  }

  return bestScore > 0 ? bestTime : null;
}

function formatSummaryToMarkdown(summary: {
  topic?: string;
  conclusions?: string[];
  actionItems?: Array<{
    action?: string;
    task?: string;
    assignee?: string;
    owner?: string;
    deadline?: string | null;
    done?: boolean;
  }>;
  discussion?: string | Array<{ topic: string; summary: string }>;
}): string {
  const lines: string[] = [];

  if (summary.topic) {
    lines.push(`# ${summary.topic}`, "");
  }

  if (summary.conclusions && summary.conclusions.length > 0) {
    lines.push("## Conclusions", "");
    for (const c of summary.conclusions) {
      lines.push(`- ${c}`);
    }
    lines.push("");
  }

  if (summary.actionItems && summary.actionItems.length > 0) {
    lines.push("## Action Items", "");
    for (const item of summary.actionItems) {
      const action = item.action || item.task || "";
      const owner = item.owner || item.assignee || "";
      const deadline = item.deadline || "";
      const check = item.done ? "x" : " ";
      let line = `- [${check}] ${action}`;
      if (owner) line += ` (@${owner})`;
      if (deadline) line += ` [Due: ${deadline}]`;
      lines.push(line);
    }
    lines.push("");
  }

  if (summary.discussion) {
    lines.push("## Discussion", "");
    if (typeof summary.discussion === "string") {
      lines.push(summary.discussion);
    } else if (Array.isArray(summary.discussion)) {
      for (const d of summary.discussion) {
        lines.push(`### ${d.topic}`, "", d.summary, "");
      }
    }
  }

  return lines.join("\n");
}

export function SummaryPanel({ onJumpToTranscript }: SummaryPanelProps) {
  const { t } = useTranslation("workspace");
  const summary = useTranscriptionStore((s) => s.summary);
  const setSummary = useTranscriptionStore((s) => s.setSummary);
  const toggleActionItem = useTranscriptionStore((s) => s.toggleActionItem);
  const segments = useTranscriptionStore((s) => s.segments);
  const status = useTranscriptionStore((s) => s.job.status);
  const pipelineStep = useTranscriptionStore((s) => s.job.pipelineStep);

  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState("");

  if (status === "post_processing" && pipelineStep === "summarizing") {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
        <Loader2 className="h-8 w-8 animate-spin" />
        <p className="text-sm">{t("summary.generating")}</p>
      </div>
    );
  }

  if (!summary) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
        <Lightbulb className="h-10 w-10" />
        <p className="text-sm">{t("summary.empty")}</p>
      </div>
    );
  }

  // Handle raw response (non-JSON fallback)
  if (
    "raw" in summary &&
    typeof (summary as Record<string, unknown>).raw === "string"
  ) {
    return (
      <div className="h-full overflow-y-auto p-4">
        <Card>
          <CardContent className="pt-6">
            <p className="whitespace-pre-wrap">
              {(summary as Record<string, unknown>).raw as string}
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const handleStartEdit = () => {
    const displayText =
      summary.editedMarkdown ??
      summary.rawMarkdown ??
      formatSummaryToMarkdown(summary);
    setEditText(displayText);
    setEditing(true);
  };

  const handleSave = () => {
    setSummary({ ...summary, editedMarkdown: editText });
    setEditing(false);
    toast.success(t("common:toast.summarySaved"));

    // Persist to SQLite
    const activeProjectId = useProjectStore.getState().activeProjectId;
    if (activeProjectId) {
      useTranscriptionStore
        .getState()
        .persistSummary(activeProjectId)
        .catch((err) => {
          console.error("Failed to persist summary:", err);
          toast.error(t("common:toast.persistFailed"));
        });
    }
  };

  const handleCancel = () => {
    setEditing(false);
    setEditText("");
  };

  // Edit mode
  if (editing) {
    return (
      <div className="flex h-full flex-col">
        <div className="flex items-center gap-2 px-4 py-2">
          <Badge variant="secondary">{t("summary.editMode")}</Badge>
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

  // View mode
  const topic = summary.topic || "";
  const conclusions = summary.conclusions || [];
  const actionItems: ActionItem[] = summary.actionItems || [];
  const discussion = summary.discussion;

  const handleJumpToTranscript = (text: string) => {
    if (!onJumpToTranscript) return;
    const time = findSegmentTime(text, segments);
    if (time !== null) {
      onJumpToTranscript(time);
    }
  };

  return (
    <div className="h-full overflow-y-auto p-4">
      <div className="mb-3 flex items-center justify-end">
        <Button variant="outline" size="sm" onClick={handleStartEdit}>
          <Pencil className="mr-1.5 h-4 w-4" />
          {t("summary.editSummary")}
        </Button>
      </div>

      <div className="space-y-3">
        {topic && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm">
                <Lightbulb className="h-4 w-4" />
                {t("summary.topic")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <h3 className="text-lg font-semibold">{topic}</h3>
            </CardContent>
          </Card>
        )}

        {conclusions.length > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm">
                <CheckCircle className="h-4 w-4" />
                {t("summary.conclusions")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-1">
                {conclusions.map((item: string, i: number) => (
                  <li key={i}>
                    <Badge variant="secondary">{item}</Badge>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}

        {actionItems.length > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm">
                <User className="h-4 w-4" />
                {t("summary.actionItems")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2">
                {actionItems.map((item: ActionItem, i: number) => {
                  const isDone = !!item.done;
                  return (
                    <li key={i} className="flex items-start gap-2">
                      <input
                        type="checkbox"
                        checked={isDone}
                        onChange={() => toggleActionItem(i)}
                        className="mt-1 h-4 w-4 shrink-0 cursor-pointer rounded border-gray-300"
                      />
                      <div className={isDone ? "line-through opacity-60" : ""}>
                        <p>{item.action || item.task}</p>
                        <div className="mt-1 flex gap-1.5">
                          {(item.owner || item.assignee) && (
                            <Badge
                              variant="outline"
                              className="gap-1 text-[10px]"
                            >
                              <User className="h-2.5 w-2.5" />
                              {item.owner || item.assignee}
                            </Badge>
                          )}
                          {item.deadline && (
                            <Badge
                              variant="outline"
                              className="gap-1 text-[10px]"
                            >
                              <Calendar className="h-2.5 w-2.5" />
                              {item.deadline}
                            </Badge>
                          )}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </CardContent>
          </Card>
        )}

        {discussion && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm">
                <MessageSquare className="h-4 w-4" />
                {t("summary.discussion")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {typeof discussion === "string" ? (
                <p className="whitespace-pre-wrap">{discussion}</p>
              ) : (
                Array.isArray(discussion) && (
                  <ul className="space-y-3">
                    {discussion.map(
                      (
                        d: { topic: string; summary: string },
                        i: number
                      ) => (
                        <li key={i}>
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-medium">{d.topic}</p>
                              <p className="mt-0.5 text-sm text-muted-foreground">
                                {d.summary}
                              </p>
                            </div>
                            {onJumpToTranscript && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 w-7 shrink-0 p-0"
                                title={t("summary.jumpToTranscript")}
                                onClick={() =>
                                  handleJumpToTranscript(d.summary)
                                }
                              >
                                <Link2 className="h-3.5 w-3.5" />
                              </Button>
                            )}
                          </div>
                        </li>
                      )
                    )}
                  </ul>
                )
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
