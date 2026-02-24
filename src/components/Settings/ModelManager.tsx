import { useEffect } from "react";
import { List, Tag, Typography, Space, Button, Badge } from "antd";
import { CloudDownloadOutlined, DeleteOutlined } from "@ant-design/icons";
import { useEngineStore } from "../../stores/engineStore";

const { Text, Title } = Typography;

interface ModelInfo {
  engine: string;
  size: string;
  description: string;
  vramGb: number;
}

const ALL_MODELS: ModelInfo[] = [
  // Whisper models
  { engine: "whisper", size: "tiny", description: "Fastest, lowest quality", vramGb: 1 },
  { engine: "whisper", size: "base", description: "Good balance for quick tasks", vramGb: 1.5 },
  { engine: "whisper", size: "small", description: "Better accuracy", vramGb: 2 },
  { engine: "whisper", size: "medium", description: "High accuracy", vramGb: 4 },
  { engine: "whisper", size: "large-v3", description: "Best accuracy", vramGb: 6 },
  // Qwen3-ASR
  { engine: "qwen3", size: "qwen3-asr-0.6B", description: "Lightweight, 22 dialects", vramGb: 3 },
  { engine: "qwen3", size: "qwen3-asr-1.7B", description: "Higher accuracy, 22 dialects", vramGb: 6 },
  // Paraformer
  { engine: "paraformer", size: "paraformer-large", description: "Fast Chinese ASR", vramGb: 2 },
  { engine: "paraformer", size: "paraformer-large-vad-punc", description: "Chinese with VAD + punctuation", vramGb: 2.5 },
  { engine: "paraformer", size: "paraformer-large-vad-punc-spk", description: "Chinese with diarization", vramGb: 3 },
];

const ENGINE_COLORS: Record<string, string> = {
  whisper: "blue",
  qwen3: "purple",
  paraformer: "green",
};

export function ModelManager() {
  const { engines, fetchEngines } = useEngineStore();

  useEffect(() => {
    fetchEngines();
  }, [fetchEngines]);

  // Build a set of currently loaded models
  const loadedModels = new Set<string>();
  for (const e of engines) {
    if (e.is_loaded && e.current_model_size) {
      loadedModels.add(`${e.name}:${e.current_model_size}`);
    }
  }

  return (
    <div style={{ padding: 16 }}>
      <Title level={4}>Model Manager</Title>
      <Text type="secondary" style={{ display: "block", marginBottom: 16 }}>
        Manage ASR engine models. Download models for offline use.
      </Text>

      <List
        dataSource={ALL_MODELS}
        renderItem={(model) => {
          const key = `${model.engine}:${model.size}`;
          const isLoaded = loadedModels.has(key);

          return (
            <List.Item
              actions={[
                isLoaded ? (
                  <Button
                    key="unload"
                    size="small"
                    icon={<DeleteOutlined />}
                    danger
                  >
                    Unload
                  </Button>
                ) : (
                  <Button
                    key="download"
                    size="small"
                    icon={<CloudDownloadOutlined />}
                    type="primary"
                    ghost
                  >
                    Download
                  </Button>
                ),
              ]}
            >
              <List.Item.Meta
                title={
                  <Space>
                    <Tag color={ENGINE_COLORS[model.engine]}>
                      {model.engine}
                    </Tag>
                    <Text strong>{model.size}</Text>
                    {isLoaded && (
                      <Badge
                        status="success"
                        text={<Text type="success">Loaded</Text>}
                      />
                    )}
                  </Space>
                }
                description={
                  <Space>
                    <Text type="secondary">{model.description}</Text>
                    <Tag>{model.vramGb} GB VRAM</Tag>
                  </Space>
                }
              />
            </List.Item>
          );
        }}
      />
    </div>
  );
}
