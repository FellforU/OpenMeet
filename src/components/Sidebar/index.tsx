import { useTranslation } from "react-i18next";
import { Plus } from "lucide-react";
import { Button } from "../ui/button";
import { ProjectList } from "./ProjectList";
import { SearchBar } from "./SearchBar";
import { useProjectStore } from "../../stores/projectStore";

interface SidebarProps {
  collapsed: boolean;
  onCollapse: (collapsed: boolean) => void;
}

export function Sidebar({ collapsed, onCollapse }: SidebarProps) {
  const { t } = useTranslation();
  const addProject = useProjectStore((s) => s.addProject);

  const handleNewProject = () => {
    const now = new Date();
    const title = `Meeting ${now.getMonth() + 1}/${now.getDate()} ${now.getHours()}:${String(now.getMinutes()).padStart(2, "0")}`;
    addProject(title);
  };

  return (
    <aside
      className={`flex flex-col border-r border-border bg-card transition-all duration-300 ${collapsed ? "w-16" : "w-60"}`}
    >
      {!collapsed && (
        <>
          <div className="flex items-center justify-between px-3 pt-4 pb-2">
            <span className="text-[15px] font-semibold">OpenMeet</span>
            <Button size="sm" onClick={handleNewProject}>
              <Plus className="mr-1 h-4 w-4" />
              {t("action.new")}
            </Button>
          </div>
          <SearchBar />
          <ProjectList />
        </>
      )}
      <button
        className="mt-auto border-t border-border p-2 text-xs text-muted-foreground hover:bg-accent"
        onClick={() => onCollapse(!collapsed)}
      >
        {collapsed ? "→" : "←"}
      </button>
    </aside>
  );
}
