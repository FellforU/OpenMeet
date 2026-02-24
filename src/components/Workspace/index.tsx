import { Tabs } from "antd";
import { FileTextOutlined, BulbOutlined, EditOutlined } from "@ant-design/icons";
import { TranscriptPanel } from "./TranscriptPanel";
import { SummaryPanel } from "./SummaryPanel";
import { SummaryEditor } from "./SummaryEditor";
import { useTranscriptionStore } from "../../stores/transcriptionStore";

export function Workspace() {
  const summary = useTranscriptionStore((s) => s.summary);

  const items = [
    {
      key: "transcript",
      label: (
        <span>
          <FileTextOutlined />
          Transcript
        </span>
      ),
      children: <TranscriptPanel />,
    },
    {
      key: "summary",
      label: (
        <span>
          <BulbOutlined />
          Summary
        </span>
      ),
      children: <SummaryPanel />,
    },
  ];

  if (summary) {
    items.push({
      key: "editor",
      label: (
        <span>
          <EditOutlined />
          Edit
        </span>
      ),
      children: <SummaryEditor />,
    });
  }

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <Tabs
        defaultActiveKey="transcript"
        style={{ flex: 1, display: "flex", flexDirection: "column" }}
        tabBarStyle={{ paddingLeft: 16, marginBottom: 0 }}
        items={items}
      />
    </div>
  );
}
