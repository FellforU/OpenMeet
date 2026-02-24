import { useState } from "react";
import { ConfigProvider, Layout, theme } from "antd";
import { Sidebar } from "./components/Sidebar";
import { HeaderBar } from "./components/HeaderBar";
import { Workspace } from "./components/Workspace";
import { ControlBar } from "./components/ControlBar";
import { StatusBar } from "./components/StatusBar";

const { Content } = Layout;

function App() {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <ConfigProvider theme={{ algorithm: theme.defaultAlgorithm }}>
      <Layout style={{ minHeight: "100vh" }}>
        <Sidebar collapsed={collapsed} onCollapse={setCollapsed} />
        <Layout style={{ display: "flex", flexDirection: "column" }}>
          <HeaderBar />
          <Content
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
            }}
          >
            <Workspace />
          </Content>
          <ControlBar />
          <StatusBar />
        </Layout>
      </Layout>
    </ConfigProvider>
  );
}

export default App;
