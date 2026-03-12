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
import { generateDefaultMeetingName } from "../../lib/meetingName";
import logoHorizontal from "../../../ico/OpenMeet_logo5.png";

interface SidebarProps {
  collapsed: boolean;
  onCollapse: (collapsed: boolean) => void;
}

export function Sidebar({ collapsed, onCollapse }: SidebarProps) {
  const { t } = useTranslation();
  const addProject = useProjectStore((s) => s.addProject);
  const addFolder = useProjectStore((s) => s.addFolder);
  const [folderDialogOpen, setFolderDialogOpen] = useState(false);

  const handleNewMeeting = async () => {
    await addProject(generateDefaultMeetingName());
  };

  const handleFolderConfirm = async (name: string) => {
    await addFolder(name);
    setFolderDialogOpen(false);
  };

  return (
    <aside
      className={`flex flex-col border-r border-border bg-card transition-all duration-300 ${collapsed ? "w-16" : "w-60"}`}
    >
      {!collapsed && (
        <>
          <div className="flex justify-center px-3 pt-5 pb-4">
            <img
              src={logoHorizontal}
              alt="OpenMeet"
              className="h-8 object-contain"
            />
          </div>
          <div className="flex items-center gap-2 px-3 pb-2">
            <div className="flex-1">
              <SearchBar compact />
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" className="h-8 shrink-0 px-2.5">
                  <Plus className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={handleNewMeeting}>
                  <FileText className="mr-2 h-4 w-4" />
                  {t("sidebar.newProject")}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setFolderDialogOpen(true)}>
                  <FolderPlus className="mr-2 h-4 w-4" />
                  {t("sidebar.newFolder")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
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
        open={folderDialogOpen}
        onClose={() => setFolderDialogOpen(false)}
        onConfirm={handleFolderConfirm}
        title={t("sidebar.newFolderTitle")}
      />
    </aside>
  );
}
