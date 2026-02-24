import { Select } from "antd";
import { useEngineStore } from "../../stores/engineStore";

export function ModelSizeSelector() {
  const { engines, selectedEngine, selectedModelSize, setSelectedModelSize } =
    useEngineStore();

  const engine = engines.find((e) => e.name === selectedEngine);
  const options = (engine?.model_sizes || []).map((size) => ({
    value: size,
    label: size,
  }));

  return (
    <Select
      value={selectedModelSize}
      onChange={setSelectedModelSize}
      options={options}
      style={{ width: 160 }}
      placeholder="Model size"
      disabled={options.length === 0}
    />
  );
}
