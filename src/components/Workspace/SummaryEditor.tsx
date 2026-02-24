import { useState } from "react";
import { Button, Input, Space, message } from "antd";
import { EditOutlined, SaveOutlined, CloseOutlined } from "@ant-design/icons";
import { useTranscriptionStore } from "../../stores/transcriptionStore";

const { TextArea } = Input;

export function SummaryEditor() {
  const summary = useTranscriptionStore((s) => s.summary);
  const setSummary = useTranscriptionStore((s) => s.setSummary);
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState("");

  if (!summary) return null;

  // Convert summary to display text
  const displayText = summary.editedMarkdown
    ?? summary.rawMarkdown
    ?? formatSummaryToMarkdown(summary);

  const handleEdit = () => {
    setEditText(displayText);
    setEditing(true);
  };

  const handleSave = () => {
    setSummary({ ...summary, editedMarkdown: editText });
    setEditing(false);
    message.success("Summary saved");
  };

  const handleCancel = () => {
    setEditing(false);
    setEditText("");
  };

  if (editing) {
    return (
      <div style={{ padding: 12 }}>
        <Space style={{ marginBottom: 8 }}>
          <Button
            type="primary"
            size="small"
            icon={<SaveOutlined />}
            onClick={handleSave}
          >
            Save
          </Button>
          <Button size="small" icon={<CloseOutlined />} onClick={handleCancel}>
            Cancel
          </Button>
        </Space>
        <TextArea
          value={editText}
          onChange={(e) => setEditText(e.target.value)}
          autoSize={{ minRows: 10, maxRows: 30 }}
          style={{ fontFamily: "monospace", fontSize: 13 }}
        />
      </div>
    );
  }

  return (
    <div style={{ padding: 12 }}>
      <Button
        size="small"
        icon={<EditOutlined />}
        onClick={handleEdit}
        style={{ marginBottom: 8 }}
      >
        Edit Summary
      </Button>
      <div
        style={{
          whiteSpace: "pre-wrap",
          fontFamily: "monospace",
          fontSize: 13,
          lineHeight: 1.6,
          padding: 12,
          backgroundColor: "#fafafa",
          borderRadius: 6,
          border: "1px solid #f0f0f0",
        }}
      >
        {displayText}
      </div>
    </div>
  );
}

function formatSummaryToMarkdown(summary: {
  topic?: string;
  conclusions?: string[];
  actionItems?: Array<{ action?: string; task?: string; assignee?: string; owner?: string; deadline?: string | null }>;
  discussion?: string | Array<{ topic: string; summary: string }>;
}): string {
  const lines: string[] = [];

  if (summary.topic) {
    lines.push(`# ${summary.topic}`, "");
  }

  if (summary.conclusions && summary.conclusions.length > 0) {
    lines.push("## Conclusions", "");
    for (const c of summary.conclusions) {
      lines.push(`- ${c}`);
    }
    lines.push("");
  }

  if (summary.actionItems && summary.actionItems.length > 0) {
    lines.push("## Action Items", "");
    for (const item of summary.actionItems) {
      const action = item.action || item.task || "";
      const owner = item.owner || item.assignee || "";
      const deadline = item.deadline || "";
      let line = `- [ ] ${action}`;
      if (owner) line += ` (@${owner})`;
      if (deadline) line += ` [Due: ${deadline}]`;
      lines.push(line);
    }
    lines.push("");
  }

  if (summary.discussion) {
    lines.push("## Discussion", "");
    if (typeof summary.discussion === "string") {
      lines.push(summary.discussion);
    } else if (Array.isArray(summary.discussion)) {
      for (const d of summary.discussion) {
        lines.push(`### ${d.topic}`, "", d.summary, "");
      }
    }
  }

  return lines.join("\n");
}
