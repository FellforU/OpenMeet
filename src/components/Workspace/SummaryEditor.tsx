import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Pencil, Save, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "../ui/button";
import { Textarea } from "../ui/textarea";
import { useTranscriptionStore } from "../../stores/transcriptionStore";

export function SummaryEditor() {
  const { t } = useTranslation("workspace");
  const summary = useTranscriptionStore((s) => s.summary);
  const setSummary = useTranscriptionStore((s) => s.setSummary);
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState("");

  if (!summary) return null;

  const displayText = summary.editedMarkdown
    ?? summary.rawMarkdown
    ?? formatSummaryToMarkdown(summary);

  const handleEdit = () => {
    setEditText(displayText);
    setEditing(true);
  };

  const handleSave = () => {
    setSummary({ ...summary, editedMarkdown: editText });
    setEditing(false);
    toast.success(t("common:toast.summarySaved"));
  };

  const handleCancel = () => {
    setEditing(false);
    setEditText("");
  };

  if (editing) {
    return (
      <div className="p-3">
        <div className="mb-2 flex gap-2">
          <Button size="sm" onClick={handleSave}>
            <Save className="mr-1.5 h-4 w-4" />
            {t("common:action.save")}
          </Button>
          <Button variant="outline" size="sm" onClick={handleCancel}>
            <X className="mr-1.5 h-4 w-4" />
            {t("common:action.cancel")}
          </Button>
        </div>
        <Textarea
          value={editText}
          onChange={(e) => setEditText(e.target.value)}
          className="min-h-[300px] font-mono text-[13px]"
        />
      </div>
    );
  }

  return (
    <div className="p-3">
      <Button variant="outline" size="sm" onClick={handleEdit} className="mb-2">
        <Pencil className="mr-1.5 h-4 w-4" />
        {t("summary.editSummary")}
      </Button>
      <div className="whitespace-pre-wrap rounded-md border border-border bg-muted/50 p-3 font-mono text-[13px] leading-relaxed">
        {displayText}
      </div>
    </div>
  );
}

function formatSummaryToMarkdown(summary: {
  topic?: string;
  conclusions?: string[];
  actionItems?: Array<{ action?: string; task?: string; assignee?: string; owner?: string; deadline?: string | null }>;
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
      let line = `- [ ] ${action}`;
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
