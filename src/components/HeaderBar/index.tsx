import { useEffect } from "react";
import { Space, Typography } from "antd";
import { EngineSelector } from "./EngineSelector";
import { ModelSizeSelector } from "./ModelSizeSelector";
import { LanguageSelector } from "./LanguageSelector";
import { useEngineStore } from "../../stores/engineStore";

const { Text } = Typography;

export function HeaderBar() {
  const fetchEngines = useEngineStore((s) => s.fetchEngines);

  useEffect(() => {
    fetchEngines();
  }, [fetchEngines]);

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "8px 16px",
        borderBottom: "1px solid #f0f0f0",
        background: "#fafafa",
      }}
    >
      <Text strong style={{ marginRight: 8 }}>
        ASR
      </Text>
      <Space size={8}>
        <LanguageSelector />
        <EngineSelector />
        <ModelSizeSelector />
      </Space>
    </div>
  );
}
