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

function segmentsToMarkdown(segments: Segment[], summary: Summary | null): string {
  let md = "# Meeting Transcription\n\n";

  if (summary) {
    md += `## ${summary.topic}\n\n`;
    if (summary.conclusions.length > 0) {
      md += "### Conclusions\n\n";
      for (const c of summary.conclusions) {
        md += `- ${c}\n`;
      }
      md += "\n";
    }
    if (summary.actionItems.length > 0) {
      md += "### Action Items\n\n";
      for (const item of summary.actionItems) {
        const check = item.done ? "[x]" : "[ ]";
        md += `- ${check} **${item.assignee}**: ${item.task}`;
        if (item.deadline) md += ` (${item.deadline})`;
        md += "\n";
      }
      md += "\n";
    }
  }

  md += "## Transcript\n\n";
  md += "| Time | Speaker | Text |\n";
  md += "|------|---------|------|\n";
  for (const seg of segments) {
    const time = `${formatTime(seg.start)} - ${formatTime(seg.end)}`;
    const speaker = seg.speaker || "-";
    md += `| ${time} | ${speaker} | ${seg.text} |\n`;
  }

  return md;
}

function segmentsToPlainText(segments: Segment[], summary: Summary | null): string {
  let text = "";

  if (summary) {
    text += `Topic: ${summary.topic}\n\n`;
    if (summary.conclusions.length > 0) {
      text += "Conclusions:\n";
      for (const c of summary.conclusions) {
        text += `  - ${c}\n`;
      }
      text += "\n";
    }
  }

  for (const seg of segments) {
    const time = `${formatTime(seg.start)} - ${formatTime(seg.end)}`;
    const speaker = seg.speaker ? `${seg.speaker}: ` : "";
    text += `[${time}] ${speaker}${seg.text}\n`;
  }

  return text;
}

function segmentsToJson(segments: Segment[], summary: Summary | null): string {
  return JSON.stringify({ segments, summary }, null, 2);
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

  const canExport = segments.length > 0;

  const handleExport = (format: string) => {
    try {
      const timestamp = new Date().toISOString().slice(0, 10);
      if (format === "markdown") {
        downloadBlob(
          segmentsToMarkdown(segments, summary),
          `meeting-${timestamp}.md`,
          "text/markdown"
        );
      } else if (format === "txt") {
        downloadBlob(
          segmentsToPlainText(segments, summary),
          `meeting-${timestamp}.txt`,
          "text/plain"
        );
      } else if (format === "json") {
        downloadBlob(
          segmentsToJson(segments, summary),
          `meeting-${timestamp}.json`,
          "application/json"
        );
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
