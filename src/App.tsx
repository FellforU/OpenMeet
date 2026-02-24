import { useState } from "react";
import { ConfigProvider, Layout, theme } from "antd";
import { Sidebar } from "./components/Sidebar";

const { Content } = Layout;

function App() {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <ConfigProvider theme={{ algorithm: theme.defaultAlgorithm }}>
      <Layout style={{ minHeight: "100vh" }}>
        <Sidebar collapsed={collapsed} onCollapse={setCollapsed} />
        <Layout>
          <Content style={{ padding: 24, background: "#fafafa" }}>
            <h2>Select or create a project to get started</h2>
          </Content>
        </Layout>
      </Layout>
    </ConfigProvider>
  );
}

export default App;
