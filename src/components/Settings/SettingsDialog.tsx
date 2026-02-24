import { Modal, Tabs, Form, Input, Switch, Select, Typography, Space, Tag } from "antd";
import {
  SettingOutlined,
  DatabaseOutlined,
  InfoCircleOutlined,
  KeyOutlined,
} from "@ant-design/icons";
import { ModelManager } from "./ModelManager";
import { APIKeyTab } from "./APIKeyTab";

const { Text, Paragraph } = Typography;

interface SettingsDialogProps {
  open: boolean;
  onClose: () => void;
}

function GeneralSettings() {
  return (
    <div style={{ padding: "8px 0" }}>
      <Form layout="vertical">
        <Form.Item label="Ollama Host" tooltip="Address of the Ollama server for LLM summaries">
          <Input defaultValue="http://localhost:11434" placeholder="http://localhost:11434" />
        </Form.Item>
        <Form.Item label="Ollama Model" tooltip="Model to use for meeting summary generation">
          <Select
            defaultValue="qwen2.5:7b"
            options={[
              { value: "qwen2.5:7b", label: "Qwen 2.5 7B" },
              { value: "qwen2.5:14b", label: "Qwen 2.5 14B" },
              { value: "mistral:7b", label: "Mistral 7B" },
              { value: "llama3.2:3b", label: "Llama 3.2 3B" },
            ]}
          />
        </Form.Item>
        <Form.Item label="Auto-generate summary" tooltip="Automatically generate meeting summary after transcription completes">
          <Switch defaultChecked />
        </Form.Item>
        <Form.Item label="Default export format">
          <Select
            defaultValue="markdown"
            options={[
              { value: "markdown", label: "Markdown" },
              { value: "txt", label: "Plain Text" },
              { value: "json", label: "JSON" },
            ]}
          />
        </Form.Item>
      </Form>
    </div>
  );
}

function AboutSection() {
  return (
    <div style={{ padding: "8px 0" }}>
      <Space direction="vertical" size="middle" style={{ width: "100%" }}>
        <div>
          <Text strong style={{ fontSize: 16 }}>OpenMeet</Text>
          <Tag style={{ marginLeft: 8 }}>v0.1.0</Tag>
        </div>
        <Paragraph type="secondary">
          Local-first AI meeting transcription tool. Supports multiple ASR engines with language-adaptive processing and LLM-powered meeting summaries.
        </Paragraph>
        <div>
          <Text type="secondary">Tech Stack: </Text>
          <Space size={4} wrap>
            <Tag color="blue">Tauri 2.x</Tag>
            <Tag color="cyan">React 19</Tag>
            <Tag color="green">FastAPI</Tag>
            <Tag color="orange">Ollama</Tag>
          </Space>
        </div>
      </Space>
    </div>
  );
}

export function SettingsDialog({ open, onClose }: SettingsDialogProps) {
  const items = [
    {
      key: "general",
      label: (
        <span>
          <SettingOutlined />
          {" General"}
        </span>
      ),
      children: <GeneralSettings />,
    },
    {
      key: "models",
      label: (
        <span>
          <DatabaseOutlined />
          {" Models"}
        </span>
      ),
      children: <ModelManager />,
    },
    {
      key: "api",
      label: (
        <span>
          <KeyOutlined />
          {" API Keys"}
        </span>
      ),
      children: <APIKeyTab />,
    },
    {
      key: "about",
      label: (
        <span>
          <InfoCircleOutlined />
          {" About"}
        </span>
      ),
      children: <AboutSection />,
    },
  ];

  return (
    <Modal
      title="Settings"
      open={open}
      onCancel={onClose}
      footer={null}
      width={640}
      styles={{ body: { minHeight: 400 } }}
    >
      <Tabs tabPosition="left" items={items} />
    </Modal>
  );
}
