# OpenMeet UI Migration & i18n Design

> Date: 2026-02-25
> Status: Approved

## Goal

1. Replace Ant Design with shadcn/ui + Tailwind CSS for a cleaner, more polished visual style (Linear/Notion-like minimalism)
2. Add i18n support (Chinese + English) with react-i18next, Chinese as default

## Current State

- 25 React components, 1,907 LOC
- 35+ Ant Design components and 30+ @ant-design/icons
- All inline styles, no CSS framework
- Zero i18n infrastructure, 150+ hardcoded English strings
- Zustand state management (unchanged)

## Dependency Changes

### Remove
- `antd` (6.3.0)
- `@ant-design/icons` (6.1.0)

### Add
- `tailwindcss` (v4) — atomic CSS
- `@tailwindcss/vite` — Vite plugin for Tailwind v4
- `lucide-react` — icon library
- `class-variance-authority` — component variant management
- `clsx` + `tailwind-merge` — style merge utilities
- `i18next` — i18n core
- `react-i18next` — React bindings
- `i18next-browser-languagedetector` — auto language detection
- `sonner` — toast notifications (replaces antd message)
- Radix UI primitives (installed via shadcn CLI): dialog, select, tabs, popover, dropdown-menu, slider, switch, progress, alert-dialog, tooltip

## File Structure

```
src/
├── components/
│   ├── ui/                    ← shadcn/ui base components
│   │   ├── button.tsx
│   │   ├── dialog.tsx
│   │   ├── select.tsx
│   │   ├── tabs.tsx
│   │   ├── input.tsx
│   │   ├── badge.tsx
│   │   ├── card.tsx
│   │   ├── dropdown-menu.tsx
│   │   ├── popover.tsx
│   │   ├── progress.tsx
│   │   ├── slider.tsx
│   │   ├── switch.tsx
│   │   ├── alert.tsx
│   │   ├── alert-dialog.tsx
│   │   ├── textarea.tsx
│   │   └── tooltip.tsx
│   ├── ControlBar/            ← rewrite with shadcn/ui + i18n
│   ├── HeaderBar/
│   ├── Sidebar/
│   ├── Workspace/
│   ├── StatusBar/
│   ├── Settings/
│   ├── Guide/
│   └── ErrorBoundary.tsx
├── i18n/
│   ├── index.ts               ← i18next init
│   ├── locales/
│   │   ├── zh/
│   │   │   ├── common.json
│   │   │   ├── workspace.json
│   │   │   ├── settings.json
│   │   │   └── guide.json
│   │   └── en/
│   │       ├── common.json
│   │       ├── workspace.json
│   │       ├── settings.json
│   │       └── guide.json
│   └── types.ts
├── lib/
│   └── utils.ts               ← cn() helper
├── App.tsx
├── globals.css                ← Tailwind base + CSS variables
└── main.tsx
```

## Component Mapping

| Ant Design | shadcn/ui Replacement |
|------------|----------------------|
| Button | Button |
| Modal | Dialog |
| Select | Select |
| Input | Input |
| Input.TextArea | Textarea |
| Input.Search | Input + Search icon |
| Input.Password | Input type=password |
| Tabs | Tabs |
| Tag | Badge |
| Steps | Custom Stepper (div + Tailwind) |
| Form | Native form + manual validation |
| Layout/Sider | div + Tailwind flex |
| ConfigProvider | CSS variables in globals.css |
| message.success/error | Sonner toast |
| Popconfirm | AlertDialog |
| Empty | Custom empty state component |
| Upload | Native input[type=file] |
| Slider | Slider |
| Switch | Switch |
| Progress | Progress |
| Dropdown | DropdownMenu |
| List | Native map + Tailwind |
| Card | Card |
| Alert | Alert |
| Popover | Popover |
| Spin | Loader icon + animate-spin |
| Typography | Native elements + Tailwind typography |
| Result | Custom component |
| Badge (status) | Badge variant |
| Space | Tailwind flex gap |
| @ant-design/icons | lucide-react |

## i18n Architecture

### Translation Namespaces

| Namespace | Content |
|-----------|---------|
| common | Buttons, status labels, general UI text |
| workspace | Transcript panel, summary, editor, export |
| settings | Settings dialog, model manager, API keys |
| guide | First-run wizard steps |

### Language Detection Order

1. `localStorage` (`openmeet_language` key)
2. `navigator.language`
3. Fallback: `zh` (Chinese)

### Usage Pattern

```tsx
const { t } = useTranslation('common');
return <Button>{t('action.save')}</Button>;
```

### Language Switcher

- Globe icon (Languages from lucide-react) in HeaderBar
- Dropdown with zh/en options
- Changes take effect immediately, no reload needed

## Visual Design Tokens

CSS variables in globals.css following shadcn/ui convention:

```css
:root {
  --background: 0 0% 100%;
  --foreground: 0 0% 3.9%;
  --card: 0 0% 100%;
  --card-foreground: 0 0% 3.9%;
  --primary: 0 0% 9%;
  --primary-foreground: 0 0% 98%;
  --secondary: 0 0% 96.1%;
  --secondary-foreground: 0 0% 9%;
  --muted: 0 0% 96.1%;
  --muted-foreground: 0 0% 45.1%;
  --accent: 0 0% 96.1%;
  --accent-foreground: 0 0% 9%;
  --destructive: 0 84.2% 60.2%;
  --destructive-foreground: 0 0% 98%;
  --border: 0 0% 89.8%;
  --input: 0 0% 89.8%;
  --ring: 0 0% 3.9%;
  --radius: 0.5rem;
}
```

## Strategy

- One-shot full replacement (not incremental)
- All 25 components rewritten in a single feature branch
- Remove antd and @ant-design/icons completely from package.json
- All hardcoded strings extracted to i18n JSON files

## Success Criteria

- Zero antd imports remaining in codebase
- All UI strings come from i18n translation files
- Language switcher works (zh ↔ en)
- Visual quality matches Linear/Notion aesthetic
- TypeScript clean (no type errors)
- Dev mode still works (`npm run tauri dev`)
