import { useTranslation } from "react-i18next";
import { XCircle } from "lucide-react";
import { toast } from "sonner";
import { Progress } from "../ui/progress";
import { Button } from "../ui/button";
import { useTranscriptionStore } from "../../stores/transcriptionStore";
import { PipelineStatus } from "./PipelineStatus";

interface StatusBarProps {
  asrReady?: boolean;
}

export function StatusBar({ asrReady }: StatusBarProps) {
  const { t } = useTranslation();
  const { job, cancelTranscription } = useTranscriptionStore();

  const handleCancel = () => {
    cancelTranscription();
    toast.info(t("toast.transcriptionCancelled"));
  };

  return (
    <div className="flex items-center gap-3 border-t border-border bg-muted/50 px-4 py-1 text-xs">
      <span
        className={`h-2 w-2 rounded-full ${asrReady ? "bg-green-500" : "bg-red-400"}`}
        title={asrReady ? "ASR Connected" : "ASR Disconnected"}
      />
      <PipelineStatus />
      {job.status === "running" && (
        <>
          <Progress value={Math.round(job.progress)} className="h-1.5 w-48" />
          <Button
            variant="ghost"
            size="sm"
            className="h-5 w-5 p-0 text-muted-foreground hover:text-destructive"
            title={t("action.cancel")}
            onClick={handleCancel}
          >
            <XCircle className="h-3.5 w-3.5" />
          </Button>
        </>
      )}
      <span className="ml-auto text-muted-foreground">
        {t("app.name")} {t("app.version")}
      </span>
    </div>
  );
}
