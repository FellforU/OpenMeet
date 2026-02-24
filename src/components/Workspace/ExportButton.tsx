import { Dropdown, Button, message } from "antd";
import {
  ExportOutlined,
  FileMarkdownOutlined,
  FileTextOutlined,
  CodeOutlined,
} from "@ant-design/icons";
import type { MenuProps } from "antd";
import { useTranscriptionStore } from "../../stores/transcriptionStore";

const ASR_BASE_URL = "http://127.0.0.1:18090";

async function downloadExport(jobId: string, format: string, ext: string) {
  try {
    const resp = await fetch(
      `${ASR_BASE_URL}/jobs/${jobId}/export?format=${format}`,
    );
    if (!resp.ok) {
      const data = await resp.json().catch(() => ({ detail: "Export failed" }));
      message.error(data.detail || "Export failed");
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
    message.success(`Exported as ${format.toUpperCase()}`);
  } catch {
    message.error("Export failed: network error");
  }
}

export function ExportButton() {
  const jobId = useTranscriptionStore((s) => s.job.id);
  const status = useTranscriptionStore((s) => s.job.status);

  const canExport = status === "completed" || status === "ready";

  const items: MenuProps["items"] = [
    {
      key: "markdown",
      icon: <FileMarkdownOutlined />,
      label: "Markdown (.md)",
      onClick: () => jobId && downloadExport(jobId, "markdown", "md"),
    },
    {
      key: "txt",
      icon: <FileTextOutlined />,
      label: "Plain Text (.txt)",
      onClick: () => jobId && downloadExport(jobId, "txt", "txt"),
    },
    {
      key: "json",
      icon: <CodeOutlined />,
      label: "JSON (.json)",
      onClick: () => jobId && downloadExport(jobId, "json", "json"),
    },
  ];

  return (
    <Dropdown menu={{ items }} disabled={!canExport} trigger={["click"]}>
      <Button icon={<ExportOutlined />} disabled={!canExport}>
        Export
      </Button>
    </Dropdown>
  );
}
