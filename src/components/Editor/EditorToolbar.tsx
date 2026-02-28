import { useTranslation } from "react-i18next";
import {
  Bold,
  Italic,
  Strikethrough,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  CheckSquare,
  Quote,
  Code,
  Minus,
  Code2,
} from "lucide-react";
import { Button } from "../ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../ui/tooltip";

interface EditorToolbarProps {
  /** Execute a ProseMirror command by name */
  onCommand: (command: string) => void;
  /** Whether we are in source mode */
  sourceMode: boolean;
  /** Toggle between source and WYSIWYG */
  onToggleSource: () => void;
}

interface ToolItem {
  icon: React.ElementType;
  command: string;
  label: string;
}

const TOOLS: (ToolItem | "separator")[] = [
  { icon: Bold, command: "toggleBold", label: "toolbar.bold" },
  { icon: Italic, command: "toggleItalic", label: "toolbar.italic" },
  { icon: Strikethrough, command: "toggleStrikethrough", label: "toolbar.strikethrough" },
  "separator",
  { icon: Heading1, command: "heading1", label: "toolbar.h1" },
  { icon: Heading2, command: "heading2", label: "toolbar.h2" },
  { icon: Heading3, command: "heading3", label: "toolbar.h3" },
  "separator",
  { icon: List, command: "bulletList", label: "toolbar.bulletList" },
  { icon: ListOrdered, command: "orderedList", label: "toolbar.orderedList" },
  { icon: CheckSquare, command: "taskList", label: "toolbar.taskList" },
  "separator",
  { icon: Quote, command: "blockquote", label: "toolbar.quote" },
  { icon: Code, command: "inlineCode", label: "toolbar.code" },
  { icon: Minus, command: "hr", label: "toolbar.hr" },
];

export function EditorToolbar({ onCommand, sourceMode, onToggleSource }: EditorToolbarProps) {
  const { t } = useTranslation("workspace");

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex items-center gap-0.5 border-b px-2 py-1">
        {!sourceMode &&
          TOOLS.map((item, i) => {
            if (item === "separator") {
              return <div key={`sep-${i}`} className="mx-1 h-5 w-px bg-border" />;
            }
            const Icon = item.icon;
            return (
              <Tooltip key={item.command}>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0"
                    onClick={() => onCommand(item.command)}
                  >
                    <Icon className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="text-xs">
                  {t(item.label)}
                </TooltipContent>
              </Tooltip>
            );
          })}

        <div className="ml-auto">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={sourceMode ? "secondary" : "ghost"}
                size="sm"
                className="h-7 gap-1 px-2 text-xs"
                onClick={onToggleSource}
              >
                <Code2 className="h-3.5 w-3.5" />
                {t("toolbar.source")}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-xs">
              {t("toolbar.toggleSource")}
            </TooltipContent>
          </Tooltip>
        </div>
      </div>
    </TooltipProvider>
  );
}
