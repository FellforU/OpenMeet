import { useState } from "react";
import { Modal, Steps, Button, Typography, Space, Tag, Alert, Result } from "antd";
import {
  AudioOutlined,
  CloudDownloadOutlined,
  RobotOutlined,
  CheckCircleOutlined,
} from "@ant-design/icons";

const { Title, Paragraph, Text } = Typography;

interface FirstRunGuideProps {
  open: boolean;
  onClose: () => void;
}

function WelcomeStep() {
  return (
    <div style={{ textAlign: "center", padding: "20px 0" }}>
      <Title level={3}>Welcome to OpenMeet</Title>
      <Paragraph type="secondary">
        Local-first AI meeting transcription tool. Let's set up your environment.
      </Paragraph>
      <Space wrap style={{ marginTop: 16 }}>
        <Tag color="blue">Offline transcription</Tag>
        <Tag color="green">Multi-engine support</Tag>
        <Tag color="orange">AI-powered summaries</Tag>
      </Space>
    </div>
  );
}

function MicrophoneStep() {
  return (
    <div style={{ padding: "16px 0" }}>
      <Title level={4}>
        <AudioOutlined style={{ marginRight: 8 }} />
        Microphone Access
      </Title>
      <Paragraph>
        OpenMeet needs microphone access for real-time transcription.
        You can also transcribe uploaded audio files without a microphone.
      </Paragraph>
      <Alert
        message="Click 'Allow' when your browser asks for microphone permission."
        type="info"
        showIcon
      />
    </div>
  );
}

function ModelStep() {
  return (
    <div style={{ padding: "16px 0" }}>
      <Title level={4}>
        <CloudDownloadOutlined style={{ marginRight: 8 }} />
        ASR Model Setup
      </Title>
      <Paragraph>
        Download an ASR model for offline transcription. You can change this later in Settings.
      </Paragraph>
      <Space direction="vertical" style={{ width: "100%" }} size="middle">
        <div style={{ padding: 12, border: "1px solid #d9f7be", borderRadius: 8, backgroundColor: "#f6ffed" }}>
          <Text strong>Recommended: Whisper Base</Text>
          <br />
          <Text type="secondary">1.5 GB VRAM - Good balance of speed and accuracy</Text>
        </div>
        <div style={{ padding: 12, border: "1px solid #f0f0f0", borderRadius: 8 }}>
          <Text strong>Whisper Tiny</Text>
          <br />
          <Text type="secondary">1 GB VRAM - Fastest, for low-end hardware</Text>
        </div>
        <div style={{ padding: 12, border: "1px solid #f0f0f0", borderRadius: 8 }}>
          <Text strong>Qwen3-ASR 0.6B (Chinese)</Text>
          <br />
          <Text type="secondary">3 GB VRAM - Best for Chinese and dialects</Text>
        </div>
      </Space>
    </div>
  );
}

function OllamaStep() {
  return (
    <div style={{ padding: "16px 0" }}>
      <Title level={4}>
        <RobotOutlined style={{ marginRight: 8 }} />
        AI Summary (Optional)
      </Title>
      <Paragraph>
        Install Ollama for AI-powered meeting summaries. This is optional — you can skip and add it later.
      </Paragraph>
      <Alert
        message={
          <span>
            Install Ollama from{" "}
            <Text code>https://ollama.com</Text>
            {" "}then run:{" "}
            <Text code>ollama pull qwen2.5:7b</Text>
          </span>
        }
        type="info"
        showIcon
      />
    </div>
  );
}

function DoneStep() {
  return (
    <Result
      icon={<CheckCircleOutlined style={{ color: "#52c41a" }} />}
      title="Setup Complete!"
      subTitle="You're ready to start transcribing meetings. Upload an audio file or start recording."
    />
  );
}

const STEPS = [
  { title: "Welcome", content: <WelcomeStep /> },
  { title: "Microphone", content: <MicrophoneStep /> },
  { title: "Model", content: <ModelStep /> },
  { title: "Ollama", content: <OllamaStep /> },
  { title: "Done", content: <DoneStep /> },
];

export function FirstRunGuide({ open, onClose }: FirstRunGuideProps) {
  const [current, setCurrent] = useState(0);

  const isLast = current === STEPS.length - 1;

  const handleNext = () => {
    if (isLast) {
      onClose();
      setCurrent(0);
    } else {
      setCurrent(current + 1);
    }
  };

  const handlePrev = () => {
    setCurrent(Math.max(0, current - 1));
  };

  return (
    <Modal
      title="Getting Started"
      open={open}
      onCancel={onClose}
      width={600}
      footer={
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <Button onClick={onClose}>Skip</Button>
          <Space>
            {current > 0 && (
              <Button onClick={handlePrev}>Previous</Button>
            )}
            <Button type="primary" onClick={handleNext}>
              {isLast ? "Get Started" : "Next"}
            </Button>
          </Space>
        </div>
      }
    >
      <Steps
        current={current}
        size="small"
        items={STEPS.map((s) => ({ title: s.title }))}
        style={{ marginBottom: 24 }}
      />
      {STEPS[current].content}
    </Modal>
  );
}
