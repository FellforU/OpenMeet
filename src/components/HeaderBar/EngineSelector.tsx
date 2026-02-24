import { Select, Tag } from "antd";
import { useEngineStore } from "../../stores/engineStore";

const ENGINE_LABELS: Record<string, string> = {
  whisper: "Whisper",
  qwen3: "Qwen3-ASR",
  paraformer: "Paraformer",
};

const ENGINE_DESCRIPTIONS: Record<string, string> = {
  whisper: "Best for English & multilingual",
  qwen3: "Best for Chinese & dialects",
  paraformer: "Fastest for Chinese",
};

export function EngineSelector() {
  const { engines, selectedEngine, setSelectedEngine } = useEngineStore();

  const options = engines.map((e) => ({
    value: e.name,
    label: (
      <span>
        {ENGINE_LABELS[e.name] || e.name}
        {e.is_loaded && (
          <Tag color="green" style={{ marginLeft: 8, fontSize: 10 }}>
            Loaded
          </Tag>
        )}
      </span>
    ),
    description: ENGINE_DESCRIPTIONS[e.name],
  }));

  return (
    <Select
      value={selectedEngine}
      onChange={setSelectedEngine}
      options={options}
      style={{ width: 180 }}
      placeholder="Select engine"
      optionRender={(option) => (
        <div>
          <div>{option.label}</div>
          <div style={{ fontSize: 11, color: "#999" }}>
            {(option.data as { description?: string }).description}
          </div>
        </div>
      )}
    />
  );
}
