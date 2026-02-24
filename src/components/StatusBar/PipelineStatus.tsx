import { Steps, Tag } from "antd";
import {
  AudioOutlined,
  FontSizeOutlined,
  MessageOutlined,
  TeamOutlined,
  FileTextOutlined,
  CheckCircleOutlined,
} from "@ant-design/icons";
import { useTranscriptionStore } from "../../stores/transcriptionStore";
import type { PipelineStep, JobStatus } from "../../types";

const PIPELINE_STEPS = [
  { key: "transcribing", label: "Transcribe", icon: <AudioOutlined /> },
  { key: "itn", label: "ITN", icon: <FontSizeOutlined /> },
  { key: "punctuation", label: "Punctuation", icon: <MessageOutlined /> },
  { key: "diarizing", label: "Diarize", icon: <TeamOutlined /> },
  { key: "summarizing", label: "Summary", icon: <FileTextOutlined /> },
] as const;

function getStepStatus(
  stepKey: string,
  currentStep: PipelineStep,
  jobStatus: JobStatus,
): "wait" | "process" | "finish" {
  if (jobStatus === "ready") return "finish";
  if (!currentStep) return "wait";

  const currentIndex = PIPELINE_STEPS.findIndex(
    (s) => s.key === currentStep,
  );
  const stepIndex = PIPELINE_STEPS.findIndex((s) => s.key === stepKey);

  if (stepIndex < currentIndex) return "finish";
  if (stepIndex === currentIndex) return "process";
  return "wait";
}

function getStatusTag(status: JobStatus): React.ReactNode {
  const colorMap: Record<string, string> = {
    idle: "default",
    running: "processing",
    paused: "warning",
    cancelled: "error",
    completed: "blue",
    post_processing: "processing",
    ready: "success",
  };

  const labelMap: Record<string, string> = {
    idle: "Idle",
    running: "Transcribing",
    paused: "Paused",
    cancelled: "Cancelled",
    completed: "Completed",
    post_processing: "Processing",
    ready: "Ready",
  };

  return (
    <Tag
      color={colorMap[status] || "default"}
      icon={status === "ready" ? <CheckCircleOutlined /> : undefined}
    >
      {labelMap[status] || status}
    </Tag>
  );
}

export function PipelineStatus() {
  const status = useTranscriptionStore((s) => s.job.status);
  const pipelineStep = useTranscriptionStore((s) => s.job.pipelineStep);
  const progress = useTranscriptionStore((s) => s.job.progress);

  // Only show pipeline when actively processing
  const showPipeline =
    status === "running" ||
    status === "post_processing" ||
    status === "ready";

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
      }}
    >
      {getStatusTag(status)}

      {showPipeline && (
        <Steps
          size="small"
          style={{ flex: 1 }}
          items={PIPELINE_STEPS.map((step) => ({
            title: step.label,
            icon: step.icon,
            status: getStepStatus(step.key, pipelineStep, status),
          }))}
        />
      )}

      {status === "running" && (
        <span style={{ fontSize: 12, color: "#999" }}>
          {Math.round(progress)}%
        </span>
      )}
    </div>
  );
}
