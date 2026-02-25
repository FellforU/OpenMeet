import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Mic,
  Trash2,
  MoreHorizontal,
  Pencil,
  ChevronRight,
  ChevronDown,
  Folder,
  FolderOpen,
} from "lucide-react";
import { Button } from "../ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { ProjectNameDialog } from "./ProjectNameDialog";
import { cn } from "@/lib/utils";
import type { Project } from "../../types";

interface ProjectItemProps {
  project: Project;
  isActive: boolean;
  level: number;
  isExpanded?: boolean;
  onClick: () => void;
  onDelete: () => void;
  onRename: (newTitle: string) => void;
  onToggleExpand?: () => void;
}

export function ProjectItem({
  project,
  isActive,
  level,
  isExpanded,
  onClick,
  onDelete,
  onRename,
  onToggleExpand,
}: ProjectItemProps) {
  const { t } = useTranslation();
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [renameDialogOpen, setRenameDialogOpen] = useState(false);

  const date = new Date(project.createdAt);
  const dateStr = `${date.getMonth() + 1}/${date.getDate()} ${date.getHours()}:${String(date.getMinutes()).padStart(2, "0")}`;

  const handleClick = () => {
    if (project.isFolder && onToggleExpand) {
      onToggleExpand();
    } else {
      onClick();
    }
  };

  const FolderIcon = isExpanded ? FolderOpen : Folder;
  const ChevronIcon = isExpanded ? ChevronDown : ChevronRight;

  return (
    <>
      <div
        onClick={handleClick}
        style={{ paddingLeft: level * 16 + 12 }}
        className={cn(
          "group mb-0.5 flex cursor-pointer items-center justify-between rounded-md border-l-[3px] pr-2 py-1.5",
          isActive && !project.isFolder
            ? "border-l-primary bg-primary/10"
            : "border-l-transparent hover:bg-accent"
        )}
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1">
            {project.isFolder && (
              <ChevronIcon className="h-3 w-3 shrink-0 text-muted-foreground" />
            )}
            {project.isFolder ? (
              <FolderIcon className="h-3.5 w-3.5 shrink-0 text-amber-500" />
            ) : (
              <Mic className="h-3 w-3 shrink-0 text-muted-foreground" />
            )}
            <span
              className={cn(
                "truncate text-[13px]",
                isActive && !project.isFolder && "font-semibold"
              )}
              style={{ maxWidth: Math.max(60, 150 - level * 16) }}
            >
              {project.title}
            </span>
          </div>
          {!project.isFolder && (
            <span
              className="ml-4 text-[11px] text-muted-foreground"
            >
              {dateStr}
            </span>
          )}
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 w-6 shrink-0 p-0 opacity-0 group-hover:opacity-100"
              onClick={(e: React.MouseEvent) => e.stopPropagation()}
            >
              <MoreHorizontal className="h-3.5 w-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            onClick={(e: React.MouseEvent) => e.stopPropagation()}
          >
            <DropdownMenuItem onClick={() => setRenameDialogOpen(true)}>
              <Pencil className="mr-2 h-3.5 w-3.5" />
              {t("sidebar.rename")}
            </DropdownMenuItem>
            <DropdownMenuItem
              className="text-destructive"
              onClick={() => setDeleteDialogOpen(true)}
            >
              <Trash2 className="mr-2 h-3.5 w-3.5" />
              {t("action.delete")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Delete confirmation dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent onClick={(e: React.MouseEvent) => e.stopPropagation()}>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("action.delete")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("sidebar.deleteConfirm")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("action.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                onDelete();
                setDeleteDialogOpen(false);
              }}
            >
              {t("action.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Rename dialog */}
      <ProjectNameDialog
        open={renameDialogOpen}
        onClose={() => setRenameDialogOpen(false)}
        onConfirm={(name) => {
          onRename(name);
          setRenameDialogOpen(false);
        }}
        title={t("sidebar.renameTitle")}
        defaultValue={project.title}
      />
    </>
  );
}
