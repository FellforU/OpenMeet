import { Button, Layout } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import { ProjectList } from "./ProjectList";
import { useProjectStore } from "../../stores/projectStore";

const { Sider } = Layout;

interface SidebarProps {
  collapsed: boolean;
  onCollapse: (collapsed: boolean) => void;
}

export function Sidebar({ collapsed, onCollapse }: SidebarProps) {
  const addProject = useProjectStore((s) => s.addProject);

  const handleNewProject = () => {
    const now = new Date();
    const title = `Meeting ${now.getMonth() + 1}/${now.getDate()} ${now.getHours()}:${String(now.getMinutes()).padStart(2, "0")}`;
    addProject(title);
  };

  return (
    <Sider
      collapsible
      collapsed={collapsed}
      onCollapse={onCollapse}
      width={240}
      style={{ background: "#fff", borderRight: "1px solid #f0f0f0" }}
    >
      {!collapsed && (
        <>
          <div
            style={{
              padding: "16px 12px 8px",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <span style={{ fontWeight: 600, fontSize: 15 }}>OpenMeet</span>
            <Button
              type="primary"
              size="small"
              icon={<PlusOutlined />}
              onClick={handleNewProject}
            >
              New
            </Button>
          </div>
          <ProjectList />
        </>
      )}
    </Sider>
  );
}
