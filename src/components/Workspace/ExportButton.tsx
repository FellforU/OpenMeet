import { useTranslation } from "react-i18next";
import { Download, FileText, FileCode, FileDown } from "lucide-react";
import { toast } from "sonner";
import { Button } from "../ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { useTranscriptionStore } from "../../stores/transcriptionStore";
import type { Segment, Summary } from "../../types";

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function buildMarkdown(segments: Segment[], summary: Summary | null): string {
  let md = "";

  // Summary section
  if (summary) {
    if (summary.editedMarkdown) {
      md += summary.editedMarkdown + "\n\n";
    } else if (summary.rawMarkdown) {
      md += summary.rawMarkdown + "\n\n";
    } else {
      md += `# ${summary.topic}\n\n`;
      if (summary.conclusions.length > 0) {
        md += "## Conclusions\n\n";
        for (const c of summary.conclusions) md += `- ${c}\n`;
        md += "\n";
      }
      if (summary.actionItems.length > 0) {
        md += "## Action Items\n\n";
        for (const item of summary.actionItems) {
          const check = item.done ? "[x]" : "[ ]";
          md += `- ${check} **${item.assignee}**: ${item.task}`;
          if (item.deadline) md += ` (${item.deadline})`;
          md += "\n";
        }
        md += "\n";
      }
      if (summary.discussion.length > 0) {
        md += "## Discussion\n\n";
        for (const d of summary.discussion) {
          md += `### ${d.topic}\n\n${d.summary}\n\n`;
        }
      }
    }
  }

  // Transcript section
  if (segments.length > 0) {
    md += "---\n\n## Transcript\n\n";
    md += "| Time | Speaker | Text |\n";
    md += "|------|---------|------|\n";
    for (const seg of segments) {
      const time = `${formatTime(seg.start)} - ${formatTime(seg.end)}`;
      const speaker = seg.speaker || "-";
      const text = seg.text.replace(/\|/g, "\\|");
      md += `| ${time} | ${speaker} | ${text} |\n`;
    }
  }

  return md;
}

function buildPlainText(segments: Segment[], summary: Summary | null): string {
  let text = "";

  if (summary) {
    text += `${summary.topic}\n${"=".repeat(summary.topic.length)}\n\n`;
    if (summary.conclusions.length > 0) {
      text += "Conclusions:\n";
      for (const c of summary.conclusions) text += `  - ${c}\n`;
      text += "\n";
    }
    if (summary.actionItems.length > 0) {
      text += "Action Items:\n";
      for (const item of summary.actionItems) {
        const mark = item.done ? "✓" : "○";
        text += `  ${mark} ${item.assignee}: ${item.task}`;
        if (item.deadline) text += ` (${item.deadline})`;
        text += "\n";
      }
      text += "\n";
    }
  }

  if (segments.length > 0) {
    text += "Transcript:\n\n";
    for (const seg of segments) {
      const time = `${formatTime(seg.start)} - ${formatTime(seg.end)}`;
      const speaker = seg.speaker ? `${seg.speaker}: ` : "";
      text += `[${time}] ${speaker}${seg.text}\n`;
    }
  }

  return text;
}

function buildJson(segments: Segment[], summary: Summary | null): string {
  return JSON.stringify({ summary, transcript: segments }, null, 2);
}

function downloadBlob(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function ExportButton() {
  const { t } = useTranslation("workspace");
  const segments = useTranscriptionStore((s) => s.segments);
  const summary = useTranscriptionStore((s) => s.summary);

  const canExport = segments.length > 0 || summary !== null;

  const handleExport = (format: string) => {
    try {
      const timestamp = new Date().toISOString().slice(0, 10);
      if (format === "markdown") {
        downloadBlob(buildMarkdown(segments, summary), `meeting-${timestamp}.md`, "text/markdown");
      } else if (format === "txt") {
        downloadBlob(buildPlainText(segments, summary), `meeting-${timestamp}.txt`, "text/plain");
      } else if (format === "json") {
        downloadBlob(buildJson(segments, summary), `meeting-${timestamp}.json`, "application/json");
      }
      toast.success(t("export.success", { format: format.toUpperCase() }));
    } catch {
      toast.error(t("export.failed"));
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" disabled={!canExport}>
          <Download className="mr-1.5 h-4 w-4" />
          {t("export.title")}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuItem onClick={() => handleExport("markdown")}>
          <FileText className="mr-2 h-4 w-4" />
          {t("export.markdown")}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => handleExport("txt")}>
          <FileDown className="mr-2 h-4 w-4" />
          {t("export.plainText")}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => handleExport("json")}>
          <FileCode className="mr-2 h-4 w-4" />
          {t("export.json")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
