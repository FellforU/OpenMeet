import { useState } from "react";
import { ConfigProvider, Layout, theme } from "antd";

const { Sider, Content } = Layout;

function App() {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <ConfigProvider theme={{ algorithm: theme.defaultAlgorithm }}>
      <Layout style={{ minHeight: "100vh" }}>
        <Sider
          collapsible
          collapsed={collapsed}
          onCollapse={setCollapsed}
          width={240}
        >
          <div style={{ padding: 16, color: "#fff", fontWeight: 600 }}>
            OpenMeet
          </div>
        </Sider>
        <Layout>
          <Content style={{ padding: 24 }}>
            <h1>Welcome to OpenMeet</h1>
            <p>AI Meeting Transcription Tool</p>
          </Content>
        </Layout>
      </Layout>
    </ConfigProvider>
  );
}

export default App;
