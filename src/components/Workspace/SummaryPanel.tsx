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
  Gavel,
  Cpu,
  ArrowRight,
  Database,
  Users,
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
  priority?: string;
  status?: string;
  done?: boolean;
}

interface SummaryPanelProps {
  onJumpToTranscript?: (time: number) => void;
}

/** Find the longest common substring length between two strings. */
function longestCommonSubstr(a: string, b: string): number {
  if (!a || !b) return 0;
  // Sliding window approach — avoid O(n*m) DP for potentially long texts
  const short = a.length <= b.length ? a : b;
  const long = a.length <= b.length ? b : a;
  let best = 0;
  for (let len = Math.min(short.length, 20); len > best; len--) {
    for (let i = 0; i <= short.length - len; i++) {
      if (long.includes(short.slice(i, i + len))) {
        best = len;
        break;
      }
    }
  }
  return best;
}

function findSegmentTime(
  summaryText: string,
  segments: Segment[]
): number | null {
  if (!segments.length) return null;

  const summaryLower = summaryText.toLowerCase();

  // Extract longer phrases (4+ Chinese chars) and English words (4+ chars) for better specificity
  const chinesePhrases = summaryLower.match(/[\u4e00-\u9fa5]{4,}/g) || [];
  const englishWords =
    summaryLower.match(/[a-zA-Z]{4,}/g) || [];
  const keywords = [...new Set([...chinesePhrases, ...englishWords])];

  let bestScore = 0;
  let bestTime: number | null = null;

  for (const seg of segments) {
    const segLower = seg.text.toLowerCase();

    // Score 1: keyword match count (weighted by keyword length)
    let kwScore = 0;
    for (const kw of keywords) {
      if (segLower.includes(kw)) kwScore += kw.length;
    }

    // Score 2: longest common substring for direct text similarity
    const lcs = longestCommonSubstr(summaryLower, segLower);

    const score = kwScore + lcs * 2;
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
  decisions?: Array<{ decision: string; madeBy: string; reasoning: string }>;
  actionItems?: Array<{
    action?: string;
    task?: string;
    assignee?: string;
    owner?: string;
    deadline?: string | null;
    priority?: string;
    done?: boolean;
  }>;
  discussion?: Array<{ topic: string; summary: string; participants?: string[]; keyPoints?: string[] }>;
  technicalDetails?: Array<{ category: string; details: string }>;
  nextSteps?: string[];
  keyData?: string[];
  participants?: string[];
}): string {
  const lines: string[] = [];

  if (summary.topic) {
    lines.push(`# ${summary.topic}`, "");
  }

  if (summary.conclusions && summary.conclusions.length > 0) {
    lines.push("## 结论", "");
    for (const c of summary.conclusions) lines.push(`- ${c}`);
    lines.push("");
  }

  if (summary.decisions && summary.decisions.length > 0) {
    lines.push("## 决策", "");
    for (const d of summary.decisions) {
      let line = `- **${d.decision}**`;
      if (d.madeBy) line += ` (${d.madeBy})`;
      if (d.reasoning) line += ` — ${d.reasoning}`;
      lines.push(line);
    }
    lines.push("");
  }

  if (summary.actionItems && summary.actionItems.length > 0) {
    lines.push("## 待办事项", "");
    for (const item of summary.actionItems) {
      const action = item.action || item.task || "";
      const owner = item.owner || item.assignee || "";
      const check = item.done ? "x" : " ";
      const priorityTag = item.priority === "high" ? " 🔴" : item.priority === "low" ? " 🟢" : "";
      let line = `- [${check}] ${action}${priorityTag}`;
      if (owner) line += ` (@${owner})`;
      if (item.deadline) line += ` [截止: ${item.deadline}]`;
      lines.push(line);
    }
    lines.push("");
  }

  if (summary.discussion && summary.discussion.length > 0) {
    lines.push("## 讨论要点", "");
    for (const d of summary.discussion) {
      lines.push(`### ${d.topic}`, "");
      if (d.participants && d.participants.length > 0) {
        lines.push(`**参与者:** ${d.participants.join("、")}`, "");
      }
      lines.push(d.summary, "");
      if (d.keyPoints && d.keyPoints.length > 0) {
        lines.push("**关键要点:**", "");
        for (const kp of d.keyPoints) lines.push(`- ${kp}`);
        lines.push("");
      }
    }
  }

  if (summary.technicalDetails && summary.technicalDetails.length > 0) {
    lines.push("## 技术细节", "");
    for (const td of summary.technicalDetails) lines.push(`- **${td.category}**: ${td.details}`);
    lines.push("");
  }

  if (summary.nextSteps && summary.nextSteps.length > 0) {
    lines.push("## 下一步", "");
    for (const step of summary.nextSteps) lines.push(`- ${step}`);
    lines.push("");
  }

  if (summary.keyData && summary.keyData.length > 0) {
    lines.push("## 关键数据", "");
    for (const data of summary.keyData) lines.push(`- ${data}`);
    lines.push("");
  }

  if (summary.participants && summary.participants.length > 0) {
    lines.push("## 参与者", "");
    lines.push(summary.participants.map((p) => `@${p}`).join("、"), "");
  }

  return lines.join("\n");
}

export function SummaryPanel({ onJumpToTranscript }: SummaryPanelProps) {
  const { t } = useTranslation("workspace");
  const summary = useTranscriptionStore((s) => s.summary);
  const setSummary = useTranscriptionStore((s) => s.setSummary);
  const toggleActionItem = useTranscriptionStore((s) => s.toggleActionItem);
  const segments = useTranscriptionStore((s) => s.segments);
  const pipelineStep = useTranscriptionStore((s) => s.job.pipelineStep);

  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState("");

  if (pipelineStep === "summarizing") {
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
  const decisions = summary.decisions || [];
  const actionItems: ActionItem[] = summary.actionItems || [];
  const discussion = summary.discussion || [];
  const technicalDetails = summary.technicalDetails || [];
  const nextSteps = summary.nextSteps || [];
  const keyData = summary.keyData || [];
  const summaryParticipants = summary.participants || [];

  const handleJumpToTranscript = (text: string) => {
    if (!onJumpToTranscript) return;
    const time = findSegmentTime(text, segments);
    if (time !== null) {
      onJumpToTranscript(time);
    }
  };

  const priorityColor = (p: string) => {
    if (p === "high") return "bg-red-100 text-red-700 border-red-200";
    if (p === "low") return "bg-green-100 text-green-700 border-green-200";
    return "bg-yellow-100 text-yellow-700 border-yellow-200";
  };

  const priorityLabel = (p: string) => {
    if (p === "high") return t("summary.priorityHigh");
    if (p === "low") return t("summary.priorityLow");
    return t("summary.priorityMedium");
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

        {decisions.length > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm">
                <Gavel className="h-4 w-4" />
                {t("summary.decisions")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-3">
                {decisions.map((d, i) => (
                  <li key={i}>
                    <p className="text-sm font-medium">{d.decision}</p>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {d.madeBy && (
                        <Badge variant="outline" className="gap-1 text-[10px]">
                          <User className="h-2.5 w-2.5" />
                          {d.madeBy}
                        </Badge>
                      )}
                      {d.reasoning && (
                        <span className="text-xs text-muted-foreground">
                          {d.reasoning}
                        </span>
                      )}
                    </div>
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
                        <div className="mt-1 flex flex-wrap gap-1.5">
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
                          {item.priority && item.priority !== "medium" && (
                            <Badge
                              variant="outline"
                              className={`text-[10px] ${priorityColor(item.priority)}`}
                            >
                              {priorityLabel(item.priority)}
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

        {discussion.length > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm">
                <MessageSquare className="h-4 w-4" />
                {t("summary.discussion")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-3">
                {discussion.map((d, i: number) => (
                  <li key={i}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium">{d.topic}</p>
                        {d.participants && d.participants.length > 0 && (
                          <div className="mt-0.5 flex flex-wrap gap-1">
                            {d.participants.map((p, pi) => (
                              <Badge key={pi} variant="outline" className="text-[10px]">
                                {p}
                              </Badge>
                            ))}
                          </div>
                        )}
                        <p className="mt-0.5 text-sm text-muted-foreground">
                          {d.summary}
                        </p>
                        {d.keyPoints && d.keyPoints.length > 0 && (
                          <ul className="mt-1 space-y-0.5">
                            {d.keyPoints.map((kp, ki) => (
                              <li key={ki} className="text-xs text-muted-foreground">
                                • {kp}
                              </li>
                            ))}
                          </ul>
                        )}
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
                ))}
              </ul>
            </CardContent>
          </Card>
        )}

        {technicalDetails.length > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm">
                <Cpu className="h-4 w-4" />
                {t("summary.technicalDetails")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2">
                {technicalDetails.map((td, i) => (
                  <li key={i}>
                    <p className="text-sm">
                      <span className="font-medium">{td.category}:</span>{" "}
                      <span className="text-muted-foreground">{td.details}</span>
                    </p>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}

        {nextSteps.length > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm">
                <ArrowRight className="h-4 w-4" />
                {t("summary.nextSteps")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-1">
                {nextSteps.map((step, i) => (
                  <li key={i} className="text-sm">• {step}</li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}

        {keyData.length > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm">
                <Database className="h-4 w-4" />
                {t("summary.keyData")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-1.5">
                {keyData.map((data, i) => (
                  <Badge key={i} variant="secondary">{data}</Badge>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {summaryParticipants.length > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm">
                <Users className="h-4 w-4" />
                {t("summary.participants")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-1.5">
                {summaryParticipants.map((p, i) => (
                  <Badge key={i} variant="outline">@{p}</Badge>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
