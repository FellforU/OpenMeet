# UI Migration & i18n Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace Ant Design with shadcn/ui + Tailwind CSS and add Chinese/English i18n support with react-i18next.

**Architecture:** One-shot full replacement of all 25 components. Tailwind v4 for styling, shadcn/ui for interactive primitives, lucide-react for icons, i18next for translations. Zustand stores and asrClient.ts remain unchanged.

**Tech Stack:** React 19, Tailwind CSS v4, shadcn/ui, Radix UI, lucide-react, i18next, react-i18next, sonner, class-variance-authority

---

## Task 1: Install Dependencies & Setup Tailwind

**Files:**
- Modify: `package.json`
- Create: `src/globals.css`
- Modify: `src/main.tsx`
- Delete: `src/App.css`
- Create: `src/lib/utils.ts`
- Create: `components.json`
- Modify: `tsconfig.json`

**Step 1: Install new dependencies**

```bash
npm install lucide-react class-variance-authority clsx tailwind-merge sonner i18next react-i18next i18next-browser-languagedetector
npm install -D tailwindcss @tailwindcss/vite
```

**Step 2: Remove antd**

```bash
npm uninstall antd @ant-design/icons
```

**Step 3: Update vite.config.ts**

```typescript
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const host = process.env.TAURI_DEV_HOST;

export default defineConfig(async () => ({
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
  resolve: {
    alias: {
      "@": "/src",
    },
  },
}));
```

**Step 4: Update tsconfig.json — add path alias**

Add to `compilerOptions`:
```json
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@/*": ["./src/*"]
    }
  }
}
```

**Step 5: Create globals.css (replaces App.css)**

```css
@import "tailwindcss";

@theme {
  --color-background: hsl(0 0% 100%);
  --color-foreground: hsl(0 0% 3.9%);
  --color-card: hsl(0 0% 100%);
  --color-card-foreground: hsl(0 0% 3.9%);
  --color-popover: hsl(0 0% 100%);
  --color-popover-foreground: hsl(0 0% 3.9%);
  --color-primary: hsl(0 0% 9%);
  --color-primary-foreground: hsl(0 0% 98%);
  --color-secondary: hsl(0 0% 96.1%);
  --color-secondary-foreground: hsl(0 0% 9%);
  --color-muted: hsl(0 0% 96.1%);
  --color-muted-foreground: hsl(0 0% 45.1%);
  --color-accent: hsl(0 0% 96.1%);
  --color-accent-foreground: hsl(0 0% 9%);
  --color-destructive: hsl(0 84.2% 60.2%);
  --color-destructive-foreground: hsl(0 0% 98%);
  --color-border: hsl(0 0% 89.8%);
  --color-input: hsl(0 0% 89.8%);
  --color-ring: hsl(0 0% 3.9%);
  --radius: 0.5rem;
}

@layer base {
  * {
    @apply border-border;
  }
  body {
    @apply bg-background text-foreground;
    font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
  }
}
```

**Step 6: Create src/lib/utils.ts**

```typescript
import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

**Step 7: Update src/main.tsx**

```typescript
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./globals.css";
import "./i18n";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
```

**Step 8: Verify Tailwind works**

Temporarily simplify App.tsx to:
```tsx
export default function App() {
  return <div className="p-8 text-2xl font-bold">Tailwind works!</div>;
}
```

Run: `npx tsc --noEmit && npm run dev`
Expected: Page shows "Tailwind works!" with padding and bold text

**Step 9: Commit**

```bash
git add -A
git commit -m "chore: setup tailwind v4, shadcn/ui utilities, remove antd"
```

---

## Task 2: Create shadcn/ui Base Components

**Files:**
- Create: `src/components/ui/button.tsx`
- Create: `src/components/ui/input.tsx`
- Create: `src/components/ui/textarea.tsx`
- Create: `src/components/ui/badge.tsx`
- Create: `src/components/ui/card.tsx`
- Create: `src/components/ui/dialog.tsx`
- Create: `src/components/ui/select.tsx`
- Create: `src/components/ui/tabs.tsx`
- Create: `src/components/ui/dropdown-menu.tsx`
- Create: `src/components/ui/popover.tsx`
- Create: `src/components/ui/slider.tsx`
- Create: `src/components/ui/switch.tsx`
- Create: `src/components/ui/progress.tsx`
- Create: `src/components/ui/alert.tsx`
- Create: `src/components/ui/alert-dialog.tsx`
- Create: `src/components/ui/tooltip.tsx`

**Step 1: Install Radix primitives**

```bash
npm install @radix-ui/react-dialog @radix-ui/react-select @radix-ui/react-tabs @radix-ui/react-dropdown-menu @radix-ui/react-popover @radix-ui/react-slider @radix-ui/react-switch @radix-ui/react-progress @radix-ui/react-alert-dialog @radix-ui/react-tooltip @radix-ui/react-slot
```

**Step 2: Create each ui component**

These follow the standard shadcn/ui patterns. Each component wraps a Radix primitive with Tailwind styling and CVA variants. Write each file following the shadcn/ui source code conventions (forwardRef, cn() merging, CVA variants for button).

Key components to implement:
- `button.tsx` — 5 variants (default, destructive, outline, secondary, ghost) + 3 sizes (sm, default, lg)
- `input.tsx` — styled native input with focus ring
- `textarea.tsx` — styled native textarea
- `badge.tsx` — 4 variants (default, secondary, destructive, outline)
- `card.tsx` — Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter
- `dialog.tsx` — Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter
- `select.tsx` — Select, SelectTrigger, SelectValue, SelectContent, SelectItem
- `tabs.tsx` — Tabs, TabsList, TabsTrigger, TabsContent
- `dropdown-menu.tsx` — DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem
- `popover.tsx` — Popover, PopoverTrigger, PopoverContent
- `slider.tsx` — Slider with track and thumb
- `switch.tsx` — Switch toggle
- `progress.tsx` — Progress bar with indicator
- `alert.tsx` — Alert, AlertTitle, AlertDescription
- `alert-dialog.tsx` — AlertDialog, AlertDialogTrigger, AlertDialogContent, AlertDialogAction, AlertDialogCancel
- `tooltip.tsx` — Tooltip, TooltipTrigger, TooltipContent, TooltipProvider

**Step 3: Verify types**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 4: Commit**

```bash
git add src/components/ui/
git commit -m "feat: add shadcn/ui base components"
```

---

## Task 3: Setup i18n Infrastructure

**Files:**
- Create: `src/i18n/index.ts`
- Create: `src/i18n/locales/zh/common.json`
- Create: `src/i18n/locales/zh/workspace.json`
- Create: `src/i18n/locales/zh/settings.json`
- Create: `src/i18n/locales/zh/guide.json`
- Create: `src/i18n/locales/en/common.json`
- Create: `src/i18n/locales/en/workspace.json`
- Create: `src/i18n/locales/en/settings.json`
- Create: `src/i18n/locales/en/guide.json`

**Step 1: Create i18n initializer**

```typescript
// src/i18n/index.ts
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";

import zhCommon from "./locales/zh/common.json";
import zhWorkspace from "./locales/zh/workspace.json";
import zhSettings from "./locales/zh/settings.json";
import zhGuide from "./locales/zh/guide.json";
import enCommon from "./locales/en/common.json";
import enWorkspace from "./locales/en/workspace.json";
import enSettings from "./locales/en/settings.json";
import enGuide from "./locales/en/guide.json";

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      zh: {
        common: zhCommon,
        workspace: zhWorkspace,
        settings: zhSettings,
        guide: zhGuide,
      },
      en: {
        common: enCommon,
        workspace: enWorkspace,
        settings: enSettings,
        guide: enGuide,
      },
    },
    fallbackLng: "zh",
    defaultNS: "common",
    ns: ["common", "workspace", "settings", "guide"],
    detection: {
      order: ["localStorage", "navigator"],
      lookupLocalStorage: "openmeet_language",
      caches: ["localStorage"],
    },
    interpolation: {
      escapeValue: false,
    },
  });

export default i18n;
```

**Step 2: Create Chinese translation files**

`src/i18n/locales/zh/common.json`:
```json
{
  "app": {
    "name": "OpenMeet",
    "version": "v0.1.0",
    "description": "本地优先的 AI 会议转录工具"
  },
  "action": {
    "save": "保存",
    "cancel": "取消",
    "confirm": "确认",
    "delete": "删除",
    "export": "导出",
    "upload": "上传",
    "download": "下载",
    "edit": "编辑",
    "search": "搜索",
    "record": "录制",
    "pause": "暂停",
    "resume": "继续",
    "stop": "停止",
    "skip": "跳过",
    "previous": "上一步",
    "next": "下一步",
    "retry": "重试",
    "reload": "重新加载",
    "close": "关闭",
    "new": "新建",
    "unload": "卸载"
  },
  "status": {
    "idle": "空闲",
    "transcribing": "转录中",
    "paused": "已暂停",
    "completed": "已完成",
    "processing": "处理中",
    "ready": "就绪",
    "cancelled": "已取消",
    "running": "运行中",
    "loaded": "已加载",
    "notLoaded": "未加载"
  },
  "language": {
    "auto": "自动检测",
    "zh": "中文",
    "en": "英文",
    "ja": "日文",
    "ko": "韩文",
    "de": "德文",
    "fr": "法文",
    "es": "西班牙文",
    "yue": "粤语",
    "wuu": "吴语（上海话）"
  },
  "engine": {
    "whisper": "Whisper",
    "qwen3": "Qwen3-ASR",
    "paraformer": "Paraformer",
    "whisperDesc": "英文和多语言最佳",
    "qwen3Desc": "中文及方言最佳",
    "paraformerDesc": "中文最快"
  },
  "model": {
    "selectSize": "模型大小",
    "tiny": "最快，质量较低",
    "base": "快速，基础质量",
    "small": "较好的准确率",
    "medium": "高准确率",
    "large": "最高准确率",
    "qwen06b": "轻量级，22种方言",
    "qwen17b": "更高准确率，22种方言",
    "paraStandard": "快速中文 ASR",
    "paraVadPunc": "中文 + VAD + 标点",
    "paraVadPuncSpk": "中文 + 说话人分离"
  },
  "sidebar": {
    "newProject": "新建项目",
    "noProjects": "暂无项目",
    "deleteConfirm": "确定要删除这个项目吗？",
    "searchPlaceholder": "搜索转录内容...",
    "noResults": "无结果"
  },
  "error": {
    "title": "出了点问题",
    "tryAgain": "重试",
    "reloadApp": "重新加载应用"
  },
  "toast": {
    "fileLoaded": "已加载: {{name}}",
    "exportSuccess": "已导出为 {{format}}",
    "exportFailed": "导出失败: 网络错误",
    "summarySaved": "摘要已保存",
    "copySuccess": "已复制到剪贴板"
  }
}
```

`src/i18n/locales/zh/workspace.json`:
```json
{
  "tabs": {
    "transcript": "转录",
    "summary": "摘要",
    "edit": "编辑"
  },
  "transcript": {
    "empty": "上传音频或开始录音以进行转录",
    "transcribing": "转录中..."
  },
  "summary": {
    "topic": "主题",
    "conclusions": "结论",
    "actionItems": "待办事项",
    "discussion": "讨论要点",
    "empty": "转录完成后将显示摘要",
    "generating": "正在生成摘要...",
    "editSummary": "编辑摘要",
    "assignee": "负责人",
    "deadline": "截止日期"
  },
  "export": {
    "title": "导出",
    "markdown": "Markdown (.md)",
    "plainText": "纯文本 (.txt)",
    "json": "JSON (.json)"
  },
  "recording": {
    "start": "开始录制",
    "recording": "录制中",
    "paused": "已暂停"
  },
  "player": {
    "speed": "倍速"
  }
}
```

`src/i18n/locales/zh/settings.json`:
```json
{
  "title": "设置",
  "tabs": {
    "general": "通用",
    "models": "模型",
    "apiKeys": "API 密钥",
    "about": "关于"
  },
  "general": {
    "ollamaHost": "Ollama 地址",
    "ollamaHostDesc": "用于 LLM 生成摘要的 Ollama 服务地址",
    "ollamaModel": "Ollama 模型",
    "ollamaModelDesc": "用于生成会议摘要的模型",
    "autoSummary": "自动生成摘要",
    "autoSummaryDesc": "转录完成后自动生成会议摘要",
    "exportFormat": "默认导出格式"
  },
  "models": {
    "title": "模型管理",
    "downloaded": "已下载",
    "available": "可用",
    "downloading": "下载中"
  },
  "apiKeys": {
    "title": "API 密钥管理",
    "openai": "OpenAI API Key",
    "alibabaId": "Access Key ID",
    "alibabaSecret": "Access Key Secret",
    "autoDegradation": "启用自动降级",
    "autoDegradationDesc": "本地 GPU 不足时自动回退到云端 API",
    "securityNote": "API 密钥仅存储在本地，不会发送到我们的服务器。"
  },
  "about": {
    "description": "本地优先的 AI 会议转录工具。基于 Tauri 2.x、React 19、FastAPI、Ollama 构建。",
    "techStack": "技术栈"
  }
}
```

`src/i18n/locales/zh/guide.json`:
```json
{
  "welcome": {
    "title": "欢迎使用 OpenMeet",
    "description": "本地优先的 AI 会议转录工具。让我们来设置你的环境。"
  },
  "microphone": {
    "title": "麦克风权限",
    "description": "浏览器请求麦克风权限时请点击「允许」。"
  },
  "model": {
    "title": "ASR 模型设置",
    "description": "选择一个适合你的语音识别模型。"
  },
  "ollama": {
    "title": "AI 摘要（可选）",
    "description": "安装 Ollama 以启用智能会议纪要功能。",
    "instruction": "从 https://ollama.com 安装 Ollama，然后运行：ollama pull qwen2.5:7b"
  },
  "done": {
    "title": "设置完成！",
    "description": "你已经准备好开始转录会议了。",
    "getStarted": "开始使用"
  }
}
```

**Step 3: Create English translation files**

Mirror the same keys with English values:

`src/i18n/locales/en/common.json`:
```json
{
  "app": {
    "name": "OpenMeet",
    "version": "v0.1.0",
    "description": "Local-first AI meeting transcription tool"
  },
  "action": {
    "save": "Save",
    "cancel": "Cancel",
    "confirm": "Confirm",
    "delete": "Delete",
    "export": "Export",
    "upload": "Upload",
    "download": "Download",
    "edit": "Edit",
    "search": "Search",
    "record": "Record",
    "pause": "Pause",
    "resume": "Resume",
    "stop": "Stop",
    "skip": "Skip",
    "previous": "Previous",
    "next": "Next",
    "retry": "Retry",
    "reload": "Reload",
    "close": "Close",
    "new": "New",
    "unload": "Unload"
  },
  "status": {
    "idle": "Idle",
    "transcribing": "Transcribing",
    "paused": "Paused",
    "completed": "Completed",
    "processing": "Processing",
    "ready": "Ready",
    "cancelled": "Cancelled",
    "running": "Running",
    "loaded": "Loaded",
    "notLoaded": "Not Loaded"
  },
  "language": {
    "auto": "Auto Detect",
    "zh": "Chinese",
    "en": "English",
    "ja": "Japanese",
    "ko": "Korean",
    "de": "German",
    "fr": "French",
    "es": "Spanish",
    "yue": "Cantonese",
    "wuu": "Wu (Shanghai)"
  },
  "engine": {
    "whisper": "Whisper",
    "qwen3": "Qwen3-ASR",
    "paraformer": "Paraformer",
    "whisperDesc": "Best for English & multilingual",
    "qwen3Desc": "Best for Chinese & dialects",
    "paraformerDesc": "Fastest for Chinese"
  },
  "model": {
    "selectSize": "Model Size",
    "tiny": "Fastest, lowest quality",
    "base": "Good balance for quick tasks",
    "small": "Better accuracy",
    "medium": "High accuracy",
    "large": "Best accuracy",
    "qwen06b": "Lightweight, 22 dialects",
    "qwen17b": "Higher accuracy, 22 dialects",
    "paraStandard": "Fast Chinese ASR",
    "paraVadPunc": "Chinese with VAD + punctuation",
    "paraVadPuncSpk": "Chinese with diarization"
  },
  "sidebar": {
    "newProject": "New Project",
    "noProjects": "No projects yet",
    "deleteConfirm": "Are you sure you want to delete this project?",
    "searchPlaceholder": "Search transcripts...",
    "noResults": "No results"
  },
  "error": {
    "title": "Something went wrong",
    "tryAgain": "Try Again",
    "reloadApp": "Reload App"
  },
  "toast": {
    "fileLoaded": "Loaded: {{name}}",
    "exportSuccess": "Exported as {{format}}",
    "exportFailed": "Export failed: network error",
    "summarySaved": "Summary saved",
    "copySuccess": "Copied to clipboard"
  }
}
```

`src/i18n/locales/en/workspace.json`:
```json
{
  "tabs": {
    "transcript": "Transcript",
    "summary": "Summary",
    "edit": "Edit"
  },
  "transcript": {
    "empty": "Upload audio or start recording to begin transcription",
    "transcribing": "Transcribing..."
  },
  "summary": {
    "topic": "Topic",
    "conclusions": "Conclusions",
    "actionItems": "Action Items",
    "discussion": "Discussion Summary",
    "empty": "Summary will appear after transcription completes",
    "generating": "Generating summary...",
    "editSummary": "Edit Summary",
    "assignee": "Assignee",
    "deadline": "Deadline"
  },
  "export": {
    "title": "Export",
    "markdown": "Markdown (.md)",
    "plainText": "Plain Text (.txt)",
    "json": "JSON (.json)"
  },
  "recording": {
    "start": "Start Recording",
    "recording": "Recording",
    "paused": "Paused"
  },
  "player": {
    "speed": "Speed"
  }
}
```

`src/i18n/locales/en/settings.json`:
```json
{
  "title": "Settings",
  "tabs": {
    "general": "General",
    "models": "Models",
    "apiKeys": "API Keys",
    "about": "About"
  },
  "general": {
    "ollamaHost": "Ollama Host",
    "ollamaHostDesc": "Address of the Ollama server for LLM summaries",
    "ollamaModel": "Ollama Model",
    "ollamaModelDesc": "Model to use for meeting summary generation",
    "autoSummary": "Auto-generate summary",
    "autoSummaryDesc": "Automatically generate meeting summary after transcription completes",
    "exportFormat": "Default export format"
  },
  "models": {
    "title": "Model Manager",
    "downloaded": "Downloaded",
    "available": "Available",
    "downloading": "Downloading"
  },
  "apiKeys": {
    "title": "API Key Management",
    "openai": "OpenAI API Key",
    "alibabaId": "Access Key ID",
    "alibabaSecret": "Access Key Secret",
    "autoDegradation": "Enable auto-degradation",
    "autoDegradationDesc": "Automatically fall back to cloud API when local GPU is insufficient",
    "securityNote": "API keys are stored locally and never sent to our servers."
  },
  "about": {
    "description": "Local-first AI meeting transcription tool. Built with Tauri 2.x, React 19, FastAPI, Ollama.",
    "techStack": "Tech Stack"
  }
}
```

`src/i18n/locales/en/guide.json`:
```json
{
  "welcome": {
    "title": "Welcome to OpenMeet",
    "description": "Local-first AI meeting transcription tool. Let's set up your environment."
  },
  "microphone": {
    "title": "Microphone Access",
    "description": "Click 'Allow' when your browser asks for microphone permission."
  },
  "model": {
    "title": "ASR Model Setup",
    "description": "Choose a speech recognition model that works best for you."
  },
  "ollama": {
    "title": "AI Summary (Optional)",
    "description": "Install Ollama to enable smart meeting summaries.",
    "instruction": "Install Ollama from https://ollama.com then run: ollama pull qwen2.5:7b"
  },
  "done": {
    "title": "Setup Complete!",
    "description": "You're ready to start transcribing meetings.",
    "getStarted": "Get Started"
  }
}
```

**Step 4: Verify i18n compiles**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 5: Commit**

```bash
git add src/i18n/
git commit -m "feat: add i18n infrastructure with zh/en translations"
```

---

## Task 4: Rewrite App Shell & Layout

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/main.tsx`
- Modify: `index.html`

**Step 1: Rewrite App.tsx**

Replace the antd ConfigProvider + Layout with plain divs + Tailwind:

```tsx
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
      <TooltipProvider>
        <div className="flex h-screen overflow-hidden bg-background text-foreground">
          <Sidebar collapsed={collapsed} onCollapse={setCollapsed} />
          <div className="flex flex-1 flex-col overflow-hidden">
            <HeaderBar />
            <main className="flex-1 overflow-hidden">
              <Workspace />
            </main>
            <ControlBar />
            <StatusBar />
          </div>
        </div>
        <Toaster position="top-right" richColors />
        <FirstRunGuide open={showGuide} onClose={handleCloseGuide} />
      </TooltipProvider>
    </ErrorBoundary>
  );
}

export default App;
```

**Step 2: Verify**

Run: `npx tsc --noEmit`
Note: This will show errors for components not yet rewritten. That's expected — we'll fix them in subsequent tasks.

**Step 3: Commit**

```bash
git add src/App.tsx src/main.tsx index.html
git commit -m "feat: rewrite app shell with tailwind layout"
```

---

## Task 5: Rewrite ErrorBoundary

**Files:**
- Modify: `src/components/ErrorBoundary.tsx`

**Step 1: Rewrite ErrorBoundary**

Replace antd Result/Button with shadcn/ui Button + Tailwind:

```tsx
import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertCircle, RefreshCw, RotateCcw } from "lucide-react";
import { Button } from "./ui/button";
import i18n from "@/i18n";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("ErrorBoundary caught:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      const t = i18n.t.bind(i18n);
      return (
        <div className="flex h-screen flex-col items-center justify-center gap-4 p-8">
          <AlertCircle className="h-12 w-12 text-destructive" />
          <h2 className="text-xl font-semibold">{t("error.title")}</h2>
          <p className="max-w-md text-center text-sm text-muted-foreground">
            {this.state.error?.message}
          </p>
          <div className="flex gap-3">
            <Button
              variant="outline"
              onClick={() => this.setState({ hasError: false, error: null })}
            >
              <RotateCcw className="mr-2 h-4 w-4" />
              {t("error.tryAgain")}
            </Button>
            <Button onClick={() => window.location.reload()}>
              <RefreshCw className="mr-2 h-4 w-4" />
              {t("error.reloadApp")}
            </Button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
```

**Step 2: Commit**

```bash
git add src/components/ErrorBoundary.tsx
git commit -m "feat: rewrite ErrorBoundary with shadcn/ui + i18n"
```

---

## Task 6: Rewrite Sidebar Components

**Files:**
- Modify: `src/components/Sidebar/index.tsx`
- Modify: `src/components/Sidebar/ProjectList.tsx`
- Modify: `src/components/Sidebar/ProjectItem.tsx`
- Modify: `src/components/Sidebar/SearchBar.tsx`

**Step 1: Rewrite all 4 sidebar files**

Replace antd Layout.Sider/Button/Popconfirm/Input.Search/List/Tag with shadcn/ui equivalents + Tailwind + useTranslation.

Key mappings:
- `Layout.Sider` → `<aside>` with Tailwind `w-60` / `w-16` + transition
- `Button` → shadcn Button with ghost/outline variant
- `Popconfirm` → shadcn AlertDialog
- `Input.Search` → shadcn Input with Search icon
- `List` → native `<div>` map with Tailwind
- `Tag` → shadcn Badge
- All strings → `t('sidebar.xxx')` or `t('action.xxx')`

**Step 2: Verify**

Run: `npx tsc --noEmit` (check for sidebar-specific errors)

**Step 3: Commit**

```bash
git add src/components/Sidebar/
git commit -m "feat: rewrite Sidebar with shadcn/ui + i18n"
```

---

## Task 7: Rewrite HeaderBar Components

**Files:**
- Modify: `src/components/HeaderBar/index.tsx`
- Modify: `src/components/HeaderBar/LanguageSelector.tsx`
- Modify: `src/components/HeaderBar/EngineSelector.tsx`
- Modify: `src/components/HeaderBar/ModelSizeSelector.tsx`

**Step 1: Rewrite all 4 header files**

Key changes:
- `Select` → shadcn Select (Radix)
- `Tag` → shadcn Badge
- `Space` → flex gap
- `Typography.Text` → `<span>` with Tailwind
- Add language switcher button (Globe icon from lucide-react)
- All strings → `t('engine.xxx')`, `t('language.xxx')`, `t('model.xxx')`
- Language switcher calls `i18n.changeLanguage()`

**Step 2: Commit**

```bash
git add src/components/HeaderBar/
git commit -m "feat: rewrite HeaderBar with shadcn/ui + i18n + language switcher"
```

---

## Task 8: Rewrite ControlBar Components

**Files:**
- Modify: `src/components/ControlBar/index.tsx`
- Modify: `src/components/ControlBar/ActionButtons.tsx`
- Modify: `src/components/ControlBar/RecordButton.tsx`
- Modify: `src/components/ControlBar/AudioPlayer.tsx`

**Step 1: Rewrite all 4 control files**

Key changes:
- `Button` → shadcn Button
- `Upload` → native `<input type="file">` hidden + Button trigger
- `message.success/error` → `toast.success/error` from sonner
- `Slider` → shadcn Slider
- `Space` → flex gap
- Recording timer display → `<span>` with Tailwind
- All strings → `t('action.xxx')`, `t('workspace:recording.xxx')`

**Step 2: Commit**

```bash
git add src/components/ControlBar/
git commit -m "feat: rewrite ControlBar with shadcn/ui + i18n"
```

---

## Task 9: Rewrite Workspace Components

**Files:**
- Modify: `src/components/Workspace/index.tsx`
- Modify: `src/components/Workspace/TranscriptPanel.tsx`
- Modify: `src/components/Workspace/SegmentItem.tsx`
- Modify: `src/components/Workspace/SpeakerBadge.tsx`
- Modify: `src/components/Workspace/SummaryPanel.tsx`
- Modify: `src/components/Workspace/SummaryEditor.tsx`
- Modify: `src/components/Workspace/ExportButton.tsx`

**Step 1: Rewrite all 7 workspace files**

Key changes:
- `Tabs` → shadcn Tabs
- `Card` → shadcn Card
- `Tag` → shadcn Badge
- `Empty` → custom empty state with lucide icon
- `Dropdown` → shadcn DropdownMenu
- `Input.TextArea` → shadcn Textarea
- `message.success` → `toast.success` from sonner
- `Spin` → `<Loader2 className="animate-spin" />`
- `Typography.Title/Paragraph/Text` → `<h3>/<p>/<span>` with Tailwind
- `List` → native map with Tailwind
- SpeakerBadge colors → Tailwind bg-xxx classes
- All strings → `t('workspace:xxx')`

**Step 2: Commit**

```bash
git add src/components/Workspace/
git commit -m "feat: rewrite Workspace with shadcn/ui + i18n"
```

---

## Task 10: Rewrite StatusBar Components

**Files:**
- Modify: `src/components/StatusBar/index.tsx`
- Modify: `src/components/StatusBar/PipelineStatus.tsx`

**Step 1: Rewrite both status files**

Key changes:
- `Progress` → shadcn Progress
- `Steps` → custom step indicator with divs + Tailwind (circles + lines)
- `Tag` → shadcn Badge
- `Space` → flex gap
- Pipeline step icons → lucide-react icons
- All strings → `t('status.xxx')`

**Step 2: Commit**

```bash
git add src/components/StatusBar/
git commit -m "feat: rewrite StatusBar with shadcn/ui + i18n"
```

---

## Task 11: Rewrite Settings Components

**Files:**
- Modify: `src/components/Settings/SettingsDialog.tsx`
- Modify: `src/components/Settings/ModelManager.tsx`
- Modify: `src/components/Settings/APIKeyTab.tsx`

**Step 1: Rewrite all 3 settings files**

Key changes:
- `Modal` → shadcn Dialog
- `Tabs` → shadcn Tabs
- `Form` → native `<form>` + `<label>` with Tailwind
- `Input` → shadcn Input
- `Input.Password` → shadcn Input with type="password" + eye toggle
- `Switch` → shadcn Switch
- `Select` → shadcn Select
- `Alert` → shadcn Alert
- `Badge` → shadcn Badge
- `List` → native map with Tailwind
- All strings → `t('settings:xxx')`

**Step 2: Commit**

```bash
git add src/components/Settings/
git commit -m "feat: rewrite Settings with shadcn/ui + i18n"
```

---

## Task 12: Rewrite FirstRunGuide

**Files:**
- Modify: `src/components/Guide/FirstRunGuide.tsx`

**Step 1: Rewrite the guide component**

Key changes:
- `Modal` → shadcn Dialog
- `Steps` → custom step indicators (circles with Tailwind)
- `Button` → shadcn Button
- `Alert` → shadcn Alert
- `Result` → custom success layout
- `Tag` → shadcn Badge
- All strings → `t('guide:xxx')`

**Step 2: Commit**

```bash
git add src/components/Guide/
git commit -m "feat: rewrite FirstRunGuide with shadcn/ui + i18n"
```

---

## Task 13: Final Cleanup & Verification

**Files:**
- Modify: `package.json` (verify antd removed)
- Delete: `src/App.css`
- Verify: all `.tsx` files have zero antd imports

**Step 1: Search for remaining antd imports**

```bash
grep -r "from \"antd\"" src/ || echo "Clean!"
grep -r "from \"@ant-design" src/ || echo "Clean!"
```

Both should print "Clean!"

**Step 2: TypeScript check**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 3: Dev mode verification**

Run: `npm run dev`
Expected: Vite starts without errors, page renders with Tailwind styles

**Step 4: Build verification**

Run: `npm run build`
Expected: Production build succeeds

**Step 5: Final commit**

```bash
git add -A
git commit -m "chore: remove antd remnants, final cleanup"
```

---

## Task Dependencies

```
Task 1 (Foundation) ──→ Task 2 (UI components) ──→ Task 4 (App shell)
                    ──→ Task 3 (i18n files)     ──→ Task 4

Task 4 ──→ Task 5 (ErrorBoundary)
       ──→ Task 6 (Sidebar)
       ──→ Task 7 (HeaderBar)
       ──→ Task 8 (ControlBar)
       ──→ Task 9 (Workspace)
       ──→ Task 10 (StatusBar)
       ──→ Task 11 (Settings)
       ──→ Task 12 (Guide)

Tasks 5-12 ──→ Task 13 (Cleanup)
```

Tasks 5-12 can be executed in parallel (independent components).

## Batch Execution Plan

| Batch | Tasks | Description |
|-------|-------|-------------|
| 1 | 1, 2, 3 | Foundation: deps, ui components, i18n files |
| 2 | 4, 5 | App shell and error boundary |
| 3 | 6, 7, 8 | Sidebar, HeaderBar, ControlBar |
| 4 | 9, 10, 11, 12 | Workspace, StatusBar, Settings, Guide |
| 5 | 13 | Final cleanup and verification |
