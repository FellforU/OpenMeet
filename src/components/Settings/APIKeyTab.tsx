import { Form, Input, Typography, Space, Tag, Alert, Switch } from "antd";
import { KeyOutlined, CloudOutlined } from "@ant-design/icons";
import { useEngineStore } from "../../stores/engineStore";

const { Paragraph } = Typography;

interface APIProvider {
  key: string;
  name: string;
  envKey: string;
  description: string;
  placeholder: string;
  color: string;
}

const API_PROVIDERS: APIProvider[] = [
  {
    key: "openai",
    name: "OpenAI Whisper",
    envKey: "OPENAI_API_KEY",
    description: "Cloud transcription via OpenAI Whisper API. Supports 50+ languages.",
    placeholder: "sk-proj-...",
    color: "green",
  },
  {
    key: "alibaba",
    name: "Alibaba Cloud ASR",
    envKey: "ALIBABA_ACCESS_KEY_ID / SECRET",
    description: "Chinese-optimized cloud ASR via DashScope Paraformer API.",
    placeholder: "LTAI5t...",
    color: "orange",
  },
];

export function APIKeyTab() {
  const selectedEngine = useEngineStore((s) => s.selectedEngine);

  return (
    <div style={{ padding: "8px 0" }}>
      <Alert
        message="API keys are stored locally and never sent to our servers."
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
      />

      <Form layout="vertical">
        {API_PROVIDERS.map((provider) => (
          <div
            key={provider.key}
            style={{
              marginBottom: 20,
              padding: 16,
              border: "1px solid #f0f0f0",
              borderRadius: 8,
              backgroundColor: selectedEngine === `${provider.key === "openai" ? "openai-whisper" : "alibaba-asr"}` ? "#f6ffed" : "transparent",
            }}
          >
            <Space style={{ marginBottom: 8 }}>
              <Tag color={provider.color} icon={<CloudOutlined />}>
                {provider.name}
              </Tag>
            </Space>
            <Paragraph type="secondary" style={{ fontSize: 12, margin: "4px 0 12px" }}>
              {provider.description}
            </Paragraph>

            {provider.key === "openai" ? (
              <Form.Item label="API Key" style={{ marginBottom: 0 }}>
                <Input.Password
                  prefix={<KeyOutlined />}
                  placeholder={provider.placeholder}
                />
              </Form.Item>
            ) : (
              <>
                <Form.Item label="Access Key ID" style={{ marginBottom: 8 }}>
                  <Input prefix={<KeyOutlined />} placeholder="LTAI5t..." />
                </Form.Item>
                <Form.Item label="Access Key Secret" style={{ marginBottom: 0 }}>
                  <Input.Password prefix={<KeyOutlined />} placeholder="..." />
                </Form.Item>
              </>
            )}
          </div>
        ))}

        <Form.Item label="Enable auto-degradation" tooltip="Automatically fall back to cloud API when local GPU is insufficient">
          <Switch defaultChecked />
        </Form.Item>
      </Form>
    </div>
  );
}
