import { useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  DragOverlay,
  DragStartEvent,
  DragEndEvent,
  DragOverEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ProjectItem } from "./ProjectItem";
import { ProjectNameDialog } from "./ProjectNameDialog";
import { useProjectStore } from "../../stores/projectStore";
import { cn } from "@/lib/utils";
import type { Project } from "../../types";

function SortableProjectItem({
  project,
  isActive,
  level,
  isExpanded,
  canCreateSubfolder,
  onClick,
  onDelete,
  onRename,
  onToggleExpand,
  onCreateMeeting,
  onCreateSubfolder,
  isOverlay,
  isDropTarget,
}: {
  project: Project;
  isActive: boolean;
  level: number;
  isExpanded?: boolean;
  canCreateSubfolder: boolean;
  onClick: () => void;
  onDelete: () => void;
  onRename: (newTitle: string) => void;
  onToggleExpand?: () => void;
  onCreateMeeting?: (parentId: string) => void;
  onCreateSubfolder?: (parentId: string) => void;
  isOverlay?: boolean;
  isDropTarget?: boolean;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: project.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.3 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={cn(
        isDropTarget && "ring-2 ring-primary ring-inset rounded-md",
        isOverlay && "shadow-lg rounded-md bg-card"
      )}
    >
      <ProjectItem
        project={project}
        isActive={isActive}
        level={isOverlay ? 0 : level}
        isExpanded={isExpanded}
        canCreateSubfolder={canCreateSubfolder}
        onClick={onClick}
        onDelete={onDelete}
        onRename={onRename}
        onToggleExpand={onToggleExpand}
        onCreateMeeting={onCreateMeeting}
        onCreateSubfolder={onCreateSubfolder}
      />
    </div>
  );
}

export function ProjectList() {
  const { t } = useTranslation();
  const {
    projects,
    activeProjectId,
    setActiveProject,
    deleteProject,
    updateProject,
    addProject,
    addFolder,
    moveItem,
    reorder,
    getItemDepth,
    getDescendantIds,
  } = useProjectStore();
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(
    new Set()
  );
  const [activeId, setActiveId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);

  // Dialog state for creating items from folder context menu
  const [createDialog, setCreateDialog] = useState<{
    parentId: string;
    mode: "meeting" | "folder";
  } | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 },
    })
  );

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

  const handleCreateMeeting = useCallback((parentId: string) => {
    setCreateDialog({ parentId, mode: "meeting" });
  }, []);

  const handleCreateSubfolder = useCallback((parentId: string) => {
    setCreateDialog({ parentId, mode: "folder" });
  }, []);

  const handleCreateConfirm = useCallback(
    (name: string) => {
      if (!createDialog) return;
      if (createDialog.mode === "meeting") {
        addProject(name, createDialog.parentId);
      } else {
        addFolder(name, createDialog.parentId);
      }
      // Auto-expand parent folder
      setExpandedFolders((prev) => new Set(prev).add(createDialog.parentId));
      setCreateDialog(null);
    },
    [createDialog, addProject, addFolder]
  );

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveId(event.active.id as string);
  }, []);

  const handleDragOver = useCallback((event: DragOverEvent) => {
    const overId = event.over?.id as string | null;
    setOverId(overId ?? null);
  }, []);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      setActiveId(null);
      setOverId(null);

      if (!over || active.id === over.id) return;

      const draggedId = active.id as string;
      const targetId = over.id as string;
      const draggedItem = projects.find((p) => p.id === draggedId);
      const targetItem = projects.find((p) => p.id === targetId);

      if (!draggedItem || !targetItem) return;

      // If dropping onto a folder, move into that folder
      if (targetItem.isFolder && targetItem.id !== draggedItem.parentId) {
        // Check depth constraints
        if (draggedItem.isFolder) {
          const targetDepth = getItemDepth(targetId);
          if (targetDepth + 1 > 2) return; // Max 2 levels for folders
          // Check that moving this folder with its children won't exceed depth
          const descendantIds = getDescendantIds(draggedId);
          if (descendantIds.includes(targetId)) return; // Can't move into descendant
        }
        moveItem(draggedId, targetId);
        // Auto-expand target folder
        setExpandedFolders((prev) => new Set(prev).add(targetId));
        return;
      }

      // Otherwise, reorder within the same parent
      if ((draggedItem.parentId ?? null) === (targetItem.parentId ?? null)) {
        const parentId = draggedItem.parentId ?? null;
        const siblings = projects
          .filter((p) => (p.parentId ?? null) === parentId)
          .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));

        const orderedIds = siblings.map((s) => s.id);

        const oldIndex = orderedIds.indexOf(draggedId);
        const newIndex = orderedIds.indexOf(targetId);

        if (oldIndex === -1 || newIndex === -1) return;

        // Move draggedId to newIndex position
        orderedIds.splice(oldIndex, 1);
        orderedIds.splice(newIndex, 0, draggedId);

        reorder(parentId, orderedIds);
      }
    },
    [projects, moveItem, reorder, getItemDepth, getDescendantIds]
  );

  const activeItem = activeId
    ? projects.find((p) => p.id === activeId)
    : null;

  if (projects.length === 0) {
    return (
      <div className="p-4 text-center text-xs text-muted-foreground">
        {t("sidebar.noProjects")}
      </div>
    );
  }

  function getSortedChildren(parentId: string | null): Project[] {
    const items = projects.filter((p) => (p.parentId ?? null) === parentId);
    // Folders first, then meetings, each sorted by sortOrder
    const folders = items
      .filter((p) => p.isFolder)
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
    const nonFolders = items
      .filter((p) => !p.isFolder)
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
    return [...folders, ...nonFolders];
  }

  function renderTree(parentId: string | null, level: number) {
    const sorted = getSortedChildren(parentId);
    const sortedIds = sorted.map((item) => item.id);

    return (
      <SortableContext
        items={sortedIds}
        strategy={verticalListSortingStrategy}
      >
        {sorted.map((item) => {
          const depth = getItemDepth(item.id);
          const canCreateSubfolder = item.isFolder && depth < 2;

          return (
            <div key={item.id}>
              <SortableProjectItem
                project={item}
                isActive={item.id === activeProjectId}
                level={level}
                isExpanded={expandedFolders.has(item.id)}
                canCreateSubfolder={canCreateSubfolder}
                onClick={() => setActiveProject(item.id)}
                onDelete={() => deleteProject(item.id)}
                onRename={(newTitle) => handleRename(item.id, newTitle)}
                onToggleExpand={
                  item.isFolder ? () => toggleExpand(item.id) : undefined
                }
                onCreateMeeting={
                  item.isFolder ? handleCreateMeeting : undefined
                }
                onCreateSubfolder={
                  item.isFolder && canCreateSubfolder
                    ? handleCreateSubfolder
                    : undefined
                }
                isDropTarget={overId === item.id && item.isFolder}
              />
              {item.isFolder &&
                expandedFolders.has(item.id) &&
                renderTree(item.id, level + 1)}
            </div>
          );
        })}
      </SortableContext>
    );
  }

  const createDialogTitle =
    createDialog?.mode === "meeting"
      ? t("sidebar.newProjectTitle")
      : t("sidebar.newFolderTitle");

  return (
    <>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
      >
        <div className="flex-1 overflow-y-auto px-2 py-1">
          {renderTree(null, 0)}
        </div>

        <DragOverlay>
          {activeItem ? (
            <SortableProjectItem
              project={activeItem}
              isActive={false}
              level={0}
              canCreateSubfolder={false}
              onClick={() => {}}
              onDelete={() => {}}
              onRename={() => {}}
              isOverlay
            />
          ) : null}
        </DragOverlay>
      </DndContext>

      {/* Create dialog triggered from folder context menu */}
      <ProjectNameDialog
        open={createDialog !== null}
        onClose={() => setCreateDialog(null)}
        onConfirm={handleCreateConfirm}
        title={createDialogTitle}
      />
    </>
  );
}
