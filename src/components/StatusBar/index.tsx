import { Progress, Space, Typography, Tag } from "antd";
import { useTranscriptionStore } from "../../stores/transcriptionStore";

const { Text } = Typography;

export function StatusBar() {
  const { job } = useTranscriptionStore();

  const statusColor: Record<string, string> = {
    idle: "default",
    running: "processing",
    paused: "warning",
    completed: "success",
    post_processing: "processing",
    ready: "success",
    cancelled: "error",
  };

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "4px 16px",
        borderTop: "1px solid #f0f0f0",
        background: "#fafafa",
        fontSize: 12,
      }}
    >
      <Tag color={statusColor[job.status] || "default"} style={{ fontSize: 11 }}>
        {job.status.toUpperCase()}
      </Tag>
      {job.status === "running" && (
        <Progress
          percent={Math.round(job.progress)}
          size="small"
          style={{ width: 200, margin: 0 }}
        />
      )}
      <Space style={{ marginLeft: "auto" }}>
        <Text type="secondary">OpenMeet v0.1.0</Text>
      </Space>
    </div>
  );
}
