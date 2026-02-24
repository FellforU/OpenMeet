import { Card, Empty, Tag, List, Typography, Spin } from "antd";
import {
  BulbOutlined,
  CheckCircleOutlined,
  UserOutlined,
  CalendarOutlined,
} from "@ant-design/icons";
import { useTranscriptionStore } from "../../stores/transcriptionStore";

const { Title, Paragraph, Text } = Typography;

interface ActionItem {
  action?: string;
  task?: string;
  assignee?: string;
  owner?: string;
  deadline?: string | null;
}

export function SummaryPanel() {
  const summary = useTranscriptionStore((s) => s.summary);
  const status = useTranscriptionStore((s) => s.job.status);
  const pipelineStep = useTranscriptionStore((s) => s.job.pipelineStep);

  if (status === "post_processing" && pipelineStep === "summarizing") {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: "100%",
        }}
      >
        <Spin tip="Generating summary..." />
      </div>
    );
  }

  if (!summary) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: "100%",
        }}
      >
        <Empty description="Summary will appear after transcription completes" />
      </div>
    );
  }

  // Handle raw response (non-JSON fallback)
  if ("raw" in summary && typeof summary.raw === "string") {
    return (
      <div style={{ padding: 16, overflowY: "auto", height: "100%" }}>
        <Card>
          <Paragraph>{summary.raw}</Paragraph>
        </Card>
      </div>
    );
  }

  const topic = summary.topic || "";
  const conclusions = summary.conclusions || [];
  const actionItems: ActionItem[] = summary.actionItems || [];
  const discussion =
    typeof summary.discussion === "string" ? summary.discussion : "";

  return (
    <div style={{ padding: 16, overflowY: "auto", height: "100%" }}>
      {/* Topic */}
      {topic && (
        <Card
          size="small"
          style={{ marginBottom: 12 }}
          title={
            <span>
              <BulbOutlined style={{ marginRight: 8 }} />
              Topic
            </span>
          }
        >
          <Title level={5} style={{ margin: 0 }}>
            {topic}
          </Title>
        </Card>
      )}

      {/* Conclusions */}
      {conclusions.length > 0 && (
        <Card
          size="small"
          style={{ marginBottom: 12 }}
          title={
            <span>
              <CheckCircleOutlined style={{ marginRight: 8 }} />
              Conclusions
            </span>
          }
        >
          <List
            size="small"
            dataSource={conclusions}
            renderItem={(item: string) => (
              <List.Item style={{ padding: "4px 0" }}>
                <Tag color="blue">{item}</Tag>
              </List.Item>
            )}
          />
        </Card>
      )}

      {/* Action Items */}
      {actionItems.length > 0 && (
        <Card
          size="small"
          style={{ marginBottom: 12 }}
          title={
            <span>
              <UserOutlined style={{ marginRight: 8 }} />
              Action Items
            </span>
          }
        >
          <List
            size="small"
            dataSource={actionItems}
            renderItem={(item: ActionItem) => (
              <List.Item style={{ padding: "6px 0" }}>
                <div>
                  <Text>{item.action || item.task}</Text>
                  <div style={{ marginTop: 4 }}>
                    {(item.owner || item.assignee) && (
                      <Tag icon={<UserOutlined />} color="green">
                        {item.owner || item.assignee}
                      </Tag>
                    )}
                    {item.deadline && (
                      <Tag icon={<CalendarOutlined />} color="orange">
                        {item.deadline}
                      </Tag>
                    )}
                  </div>
                </div>
              </List.Item>
            )}
          />
        </Card>
      )}

      {/* Discussion */}
      {discussion && (
        <Card size="small" title="Discussion Summary">
          <Paragraph>{discussion}</Paragraph>
        </Card>
      )}
    </div>
  );
}
