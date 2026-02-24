import { Typography, Button, Popconfirm } from "antd";
import { DeleteOutlined, AudioOutlined } from "@ant-design/icons";
import type { Project } from "../../types";

const { Text } = Typography;

interface ProjectItemProps {
  project: Project;
  isActive: boolean;
  onClick: () => void;
  onDelete: () => void;
}

export function ProjectItem({ project, isActive, onClick, onDelete }: ProjectItemProps) {
  const date = new Date(project.createdAt);
  const dateStr = `${date.getMonth() + 1}/${date.getDate()} ${date.getHours()}:${String(date.getMinutes()).padStart(2, "0")}`;

  return (
    <div
      onClick={onClick}
      style={{
        padding: "8px 12px",
        cursor: "pointer",
        borderRadius: 6,
        backgroundColor: isActive ? "rgba(22,119,255,0.1)" : "transparent",
        borderLeft: isActive ? "3px solid #1677ff" : "3px solid transparent",
        marginBottom: 4,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
      }}
    >
      <div style={{ overflow: "hidden" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <AudioOutlined style={{ fontSize: 12, color: "#999" }} />
          <Text
            ellipsis
            strong={isActive}
            style={{ fontSize: 13, maxWidth: 150 }}
          >
            {project.title}
          </Text>
        </div>
        <Text type="secondary" style={{ fontSize: 11 }}>
          {dateStr}
        </Text>
      </div>
      <Popconfirm
        title="Delete this project?"
        onConfirm={(e) => {
          e?.stopPropagation();
          onDelete();
        }}
        onCancel={(e) => e?.stopPropagation()}
      >
        <Button
          type="text"
          size="small"
          icon={<DeleteOutlined />}
          onClick={(e) => e.stopPropagation()}
          style={{ opacity: 0.5 }}
        />
      </Popconfirm>
    </div>
  );
}
