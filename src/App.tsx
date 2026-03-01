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
import { useEngineStore } from "./stores/engineStore";
import { ChatButton } from "./components/Chat/ChatButton";

function App() {
  const [collapsed, setCollapsed] = useState(false);
  const [showGuide, setShowGuide] = useState(false);
  const [asrReady, setAsrReady] = useState(false);

  // Database + ASR initialization (sequential to ensure settings load before ASR starts)
  useEffect(() => {
    let cancelled = false;

    async function init() {
      // 1. Load settings first — ASR startup depends on modelCacheDir
      try {
        await migrateFromLocalStorage();
        await useProjectStore.getState().loadProjects();
        await useSettingsStore.getState().loadSettings();

        const done = await invoke<string | null>("db_get_setting", {
          key: "first_run_done",
        });
        if (!done) {
          setShowGuide(true);
        }
      } catch {
        const done = localStorage.getItem("openmeet_first_run_done");
        if (!done) {
          setShowGuide(true);
        }
      }

      // 2. Start ASR with correct cache dir and HF mirror (settings are now loaded)
      try {
        const { general } = useSettingsStore.getState();
        const cacheDir = general.modelCacheDir || undefined;
        const hfMirror = general.hfMirror || undefined;
        await startAsrService(cacheDir, hfMirror);
      } catch {
        // May already be running or in browser dev mode
      }

      // 3. Wait for ASR health, then push config and refresh engines
      const check = async () => {
        try {
          await checkAsrHealth();
          if (!cancelled) {
            await pushKnowledgeConfig();
            pushCredentials();
            // Refresh engine list after config is applied (correct cache dir)
            useEngineStore.getState().fetchEngines();
            setAsrReady(true);
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

    init();
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
