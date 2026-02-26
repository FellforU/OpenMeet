import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Plus, FileText, FolderPlus } from "lucide-react";
import { Button } from "../ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { ProjectList } from "./ProjectList";
import { ProjectNameDialog } from "./ProjectNameDialog";
import { SearchBar } from "./SearchBar";
import { useProjectStore } from "../../stores/projectStore";
import logoHorizontal from "../../../ico/OpenMeet_logo5.png";

interface SidebarProps {
  collapsed: boolean;
  onCollapse: (collapsed: boolean) => void;
}

type DialogMode = "project" | "folder" | null;

export function Sidebar({ collapsed, onCollapse }: SidebarProps) {
  const { t } = useTranslation();
  const addProject = useProjectStore((s) => s.addProject);
  const addFolder = useProjectStore((s) => s.addFolder);
  const [dialogMode, setDialogMode] = useState<DialogMode>(null);

  const handleConfirm = (name: string) => {
    if (dialogMode === "project") {
      addProject(name);
    } else if (dialogMode === "folder") {
      addFolder(name);
    }
    setDialogMode(null);
  };

  const dialogTitle =
    dialogMode === "project"
      ? t("sidebar.newProjectTitle")
      : t("sidebar.newFolderTitle");

  return (
    <aside
      className={`flex flex-col border-r border-border bg-card transition-all duration-300 ${collapsed ? "w-16" : "w-60"}`}
    >
      {!collapsed && (
        <>
          <div className="px-3 pt-4 pb-1">
            <img src={logoHorizontal} alt="OpenMeet" className="h-12 object-contain" />
          </div>
          <div className="flex items-center justify-end px-3 pb-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm">
                  <Plus className="mr-1 h-4 w-4" />
                  {t("action.new")}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => setDialogMode("project")}>
                  <FileText className="mr-2 h-4 w-4" />
                  {t("sidebar.newProject")}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setDialogMode("folder")}>
                  <FolderPlus className="mr-2 h-4 w-4" />
                  {t("sidebar.newFolder")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <SearchBar />
          <ProjectList />
        </>
      )}
      <button
        className="mt-auto border-t border-border p-2 text-xs text-muted-foreground hover:bg-accent"
        onClick={() => onCollapse(!collapsed)}
      >
        {collapsed ? "\u2192" : "\u2190"}
      </button>

      <ProjectNameDialog
        open={dialogMode !== null}
        onClose={() => setDialogMode(null)}
        onConfirm={handleConfirm}
        title={dialogTitle}
      />
    </aside>
  );
}
