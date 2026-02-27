import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
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
import { configureKnowledge } from "./services/knowledgeClient";
import { migrateFromLocalStorage } from "./services/dataMigration";
import { useSettingsStore } from "./stores/settingsStore";
import { useProjectStore } from "./stores/projectStore";
import { ChatButton } from "./components/Chat/ChatButton";

function App() {
  const [collapsed, setCollapsed] = useState(false);
  const [showGuide, setShowGuide] = useState(false);
  const [asrReady, setAsrReady] = useState(false);

  // Database initialization and data loading
  useEffect(() => {
    async function initDatabase() {
      try {
        await migrateFromLocalStorage();
        await useProjectStore.getState().loadProjects();
        await useSettingsStore.getState().loadSettings();

        // Check first-run flag from SQLite
        const done = await invoke<string | null>("db_get_setting", {
          key: "first_run_done",
        });
        if (!done) {
          setShowGuide(true);
        }
      } catch {
        // Fallback: may be running in browser dev mode without Tauri
        const done = localStorage.getItem("openmeet_first_run_done");
        if (!done) {
          setShowGuide(true);
        }
      }
    }
    initDatabase();
  }, []);

  // ASR service lifecycle + credential push
  useEffect(() => {
    let cancelled = false;

    async function initAsr() {
      try {
        const { general } = useSettingsStore.getState();
        const cacheDir = general.modelCacheDir || undefined;
        await startAsrService(cacheDir);
      } catch {
        // May already be running or in browser dev mode
      }

      const check = async () => {
        try {
          await checkAsrHealth();
          if (!cancelled) {
            setAsrReady(true);
            pushCredentials();
            pushKnowledgeConfig();
          }
        } catch {
          if (!cancelled) setTimeout(check, 2000);
        }
      };
      check();
    }

    async function pushKnowledgeConfig() {
      try {
        const appDataDir = await invoke<string>("get_app_data_dir");
        await configureKnowledge(appDataDir);
      } catch {
        // Knowledge features unavailable without config
      }
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

  const handleCloseGuide = async () => {
    setShowGuide(false);
    try {
      await invoke("db_set_setting", {
        key: "first_run_done",
        value: "true",
      });
    } catch {
      // Fallback for browser dev mode
      localStorage.setItem("openmeet_first_run_done", "true");
    }
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
        <ChatButton />
        <Toaster position="top-right" richColors />
        <FirstRunGuide open={showGuide} onClose={handleCloseGuide} />
      </TooltipProvider>
    </ErrorBoundary>
  );
}

export default App;
