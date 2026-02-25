import { useTranslation } from "react-i18next";
import { Mic, Type, MessageSquare, Users, FileText, CheckCircle } from "lucide-react";
import { Badge } from "../ui/badge";
import { cn } from "@/lib/utils";
import { useTranscriptionStore } from "../../stores/transcriptionStore";
import type { PipelineStep, JobStatus } from "../../types";

const PIPELINE_STEPS = [
  { key: "transcribing" as const, icon: Mic },
  { key: "itn" as const, icon: Type },
  { key: "punctuation" as const, icon: MessageSquare },
  { key: "diarizing" as const, icon: Users },
  { key: "summarizing" as const, icon: FileText },
];

const STATUS_LABEL_MAP: Record<string, string> = {
  idle: "status.idle",
  running: "status.transcribing",
  paused: "status.paused",
  cancelled: "status.cancelled",
  completed: "status.completed",
  post_processing: "status.processing",
  ready: "status.ready",
};

const STATUS_VARIANT_MAP: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  idle: "secondary",
  running: "default",
  paused: "outline",
  cancelled: "destructive",
  completed: "secondary",
  post_processing: "default",
  ready: "default",
};

function getStepState(
  stepKey: string,
  currentStep: PipelineStep,
  jobStatus: JobStatus,
): "done" | "active" | "pending" {
  if (jobStatus === "ready") return "done";
  if (!currentStep) return "pending";

  const currentIndex = PIPELINE_STEPS.findIndex((s) => s.key === currentStep);
  const stepIndex = PIPELINE_STEPS.findIndex((s) => s.key === stepKey);

  if (stepIndex < currentIndex) return "done";
  if (stepIndex === currentIndex) return "active";
  return "pending";
}

export function PipelineStatus() {
  const { t } = useTranslation();
  const status = useTranscriptionStore((s) => s.job.status);
  const pipelineStep = useTranscriptionStore((s) => s.job.pipelineStep);
  const progress = useTranscriptionStore((s) => s.job.progress);

  const showPipeline =
    status === "running" ||
    status === "post_processing" ||
    status === "ready";

  return (
    <div className="flex items-center gap-3">
      <Badge variant={STATUS_VARIANT_MAP[status] || "secondary"}>
        {status === "ready" && <CheckCircle className="mr-1 h-3 w-3" />}
        {t(STATUS_LABEL_MAP[status] || "status.idle")}
      </Badge>

      {showPipeline && (
        <div className="flex items-center gap-1">
          {PIPELINE_STEPS.map((step, i) => {
            const state = getStepState(step.key, pipelineStep, status);
            const Icon = step.icon;
            return (
              <div key={step.key} className="flex items-center">
                {i > 0 && (
                  <div
                    className={cn(
                      "mx-0.5 h-px w-3",
                      state === "pending" ? "bg-border" : "bg-primary"
                    )}
                  />
                )}
                <div
                  className={cn(
                    "flex h-5 w-5 items-center justify-center rounded-full",
                    state === "done" && "bg-primary text-primary-foreground",
                    state === "active" && "bg-primary/20 text-primary ring-1 ring-primary",
                    state === "pending" && "bg-muted text-muted-foreground"
                  )}
                >
                  <Icon className="h-2.5 w-2.5" />
                </div>
              </div>
            );
          })}
        </div>
      )}

      {status === "running" && (
        <span className="text-muted-foreground">
          {Math.round(progress)}%
        </span>
      )}
    </div>
  );
}
