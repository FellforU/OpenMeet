import { useState, useEffect } from "react";
import { Toaster } from "sonner";
import { Sidebar } from "./components/Sidebar";
import { HeaderBar } from "./components/HeaderBar";
import { Workspace } from "./components/Workspace";
import { ControlBar } from "./components/ControlBar";
import { StatusBar } from "./components/StatusBar";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { FirstRunGuide } from "./components/Guide/FirstRunGuide";
import { TooltipProvider } from "./components/ui/tooltip";
import { startAsrService, checkAsrHealth, configureEngine } from "./services/asrClient";
import { useSettingsStore } from "./stores/settingsStore";

const FIRST_RUN_KEY = "openmeet_first_run_done";

function App() {
  const [collapsed, setCollapsed] = useState(false);
  const [showGuide, setShowGuide] = useState(false);
  const [asrReady, setAsrReady] = useState(false);

  useEffect(() => {
    const done = localStorage.getItem(FIRST_RUN_KEY);
    if (!done) {
      setShowGuide(true);
    }
  }, []);

  // ASR service lifecycle + credential push
  useEffect(() => {
    let cancelled = false;

    async function initAsr() {
      try {
        await startAsrService();
      } catch {
        // May already be running or in browser dev mode
      }

      const check = async () => {
        try {
          await checkAsrHealth();
          if (!cancelled) {
            setAsrReady(true);
            pushCredentials();
          }
        } catch {
          if (!cancelled) setTimeout(check, 2000);
        }
      };
      check();
    }

    function pushCredentials() {
      const { cloudAsr } = useSettingsStore.getState();
      if (cloudAsr.openaiWhisper.apiKey) {
        configureEngine("openai-whisper", {
          api_key: cloudAsr.openaiWhisper.apiKey,
        }).catch(() => {});
      }
      if (cloudAsr.alibabaAsr.keyId && cloudAsr.alibabaAsr.secret) {
        configureEngine("alibaba-asr", {
          access_key_id: cloudAsr.alibabaAsr.keyId,
          access_key_secret: cloudAsr.alibabaAsr.secret,
        }).catch(() => {});
      }
    }

    initAsr();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleCloseGuide = () => {
    setShowGuide(false);
    localStorage.setItem(FIRST_RUN_KEY, "true");
  };

  return (
    <ErrorBoundary>
      <TooltipProvider>
        <div className="flex h-screen overflow-hidden bg-background text-foreground">
          <Sidebar collapsed={collapsed} onCollapse={setCollapsed} />
          <div className="flex flex-1 flex-col overflow-hidden">
            <HeaderBar />
            <main className="flex-1 overflow-hidden">
              <Workspace />
            </main>
            <ControlBar />
            <StatusBar asrReady={asrReady} />
          </div>
        </div>
        <Toaster position="top-right" richColors />
        <FirstRunGuide open={showGuide} onClose={handleCloseGuide} />
      </TooltipProvider>
    </ErrorBoundary>
  );
}

export default App;
