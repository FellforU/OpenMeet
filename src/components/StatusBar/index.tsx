import { Progress, Space, Typography } from "antd";
import { useTranscriptionStore } from "../../stores/transcriptionStore";
import { PipelineStatus } from "./PipelineStatus";

const { Text } = Typography;

export function StatusBar() {
  const { job } = useTranscriptionStore();

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
      <PipelineStatus />
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
