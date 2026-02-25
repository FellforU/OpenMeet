import { useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { ProjectItem } from "./ProjectItem";
import { useProjectStore } from "../../stores/projectStore";

export function ProjectList() {
  const { t } = useTranslation();
  const { projects, activeProjectId, setActiveProject, deleteProject, updateProject } =
    useProjectStore();
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());

  const toggleExpand = useCallback((folderId: string) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(folderId)) {
        next.delete(folderId);
      } else {
        next.add(folderId);
      }
      return next;
    });
  }, []);

  const handleRename = useCallback(
    (id: string, newTitle: string) => {
      updateProject(id, { title: newTitle });
    },
    [updateProject]
  );

  if (projects.length === 0) {
    return (
      <div className="p-4 text-center text-xs text-muted-foreground">
        {t("sidebar.noProjects")}
      </div>
    );
  }

  function renderTree(parentId: string | null, level: number) {
    const items = projects.filter((p) => (p.parentId ?? null) === parentId);
    // Folders first, then projects, each sorted by creation date (newest first)
    const folders = items.filter((p) => p.isFolder);
    const nonFolders = items.filter((p) => !p.isFolder);
    const sorted = [...folders, ...nonFolders];

    return sorted.map((item) => (
      <div key={item.id}>
        <ProjectItem
          project={item}
          isActive={item.id === activeProjectId}
          level={level}
          isExpanded={expandedFolders.has(item.id)}
          onClick={() => setActiveProject(item.id)}
          onDelete={() => deleteProject(item.id)}
          onRename={(newTitle) => handleRename(item.id, newTitle)}
          onToggleExpand={
            item.isFolder ? () => toggleExpand(item.id) : undefined
          }
        />
        {item.isFolder && expandedFolders.has(item.id) && renderTree(item.id, level + 1)}
      </div>
    ));
  }

  return (
    <div className="flex-1 overflow-y-auto px-2 py-1">
      {renderTree(null, 0)}
    </div>
  );
}
