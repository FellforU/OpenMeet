import { useState, useEffect } from "react";
import { ConfigProvider, Layout, theme } from "antd";
import { Sidebar } from "./components/Sidebar";
import { HeaderBar } from "./components/HeaderBar";
import { Workspace } from "./components/Workspace";
import { ControlBar } from "./components/ControlBar";
import { StatusBar } from "./components/StatusBar";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { FirstRunGuide } from "./components/Guide/FirstRunGuide";

const { Content } = Layout;

const FIRST_RUN_KEY = "openmeet_first_run_done";

function App() {
  const [collapsed, setCollapsed] = useState(false);
  const [showGuide, setShowGuide] = useState(false);

  useEffect(() => {
    const done = localStorage.getItem(FIRST_RUN_KEY);
    if (!done) {
      setShowGuide(true);
    }
  }, []);

  const handleCloseGuide = () => {
    setShowGuide(false);
    localStorage.setItem(FIRST_RUN_KEY, "true");
  };

  return (
    <ErrorBoundary>
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
        <FirstRunGuide open={showGuide} onClose={handleCloseGuide} />
      </ConfigProvider>
    </ErrorBoundary>
  );
}

export default App;
