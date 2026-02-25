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

const ASR_BASE_URL = "http://127.0.0.1:18090";

async function downloadExport(jobId: string, format: string, ext: string, t: (key: string, opts?: Record<string, string>) => string) {
  try {
    const resp = await fetch(
      `${ASR_BASE_URL}/jobs/${jobId}/export?format=${format}`,
    );
    if (!resp.ok) {
      const data = await resp.json().catch(() => ({ detail: "Export failed" }));
      toast.error(data.detail || t("common:toast.exportFailed"));
      return;
    }

    const blob = await resp.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `meeting-notes.${ext}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success(t("common:toast.exportSuccess", { format: format.toUpperCase() }));
  } catch {
    toast.error(t("common:toast.exportFailed"));
  }
}

export function ExportButton() {
  const { t } = useTranslation("workspace");
  const jobId = useTranscriptionStore((s) => s.job.id);
  const status = useTranscriptionStore((s) => s.job.status);

  const canExport = status === "completed" || status === "ready";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" disabled={!canExport}>
          <Download className="mr-1.5 h-4 w-4" />
          {t("export.title")}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuItem onClick={() => jobId && downloadExport(jobId, "markdown", "md", t)}>
          <FileText className="mr-2 h-4 w-4" />
          {t("export.markdown")}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => jobId && downloadExport(jobId, "txt", "txt", t)}>
          <FileDown className="mr-2 h-4 w-4" />
          {t("export.plainText")}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => jobId && downloadExport(jobId, "json", "json", t)}>
          <FileCode className="mr-2 h-4 w-4" />
          {t("export.json")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
