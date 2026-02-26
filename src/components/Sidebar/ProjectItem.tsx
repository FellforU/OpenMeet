import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  Mic,
  Trash2,
  MoreHorizontal,
  Pencil,
  ChevronRight,
  ChevronDown,
  Folder,
  FolderOpen,
  FolderPlus,
  FileText,
  Move,
  Sparkles,
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
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { ProjectNameDialog } from "./ProjectNameDialog";
import { MoveDialog } from "./MoveDialog";
import { cn } from "@/lib/utils";
import type { Project } from "../../types";
import { generateMeetingTitle } from "../../services/llmClient";
import { useTranscriptionStore } from "../../stores/transcriptionStore";

interface ProjectItemProps {
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
}

export function ProjectItem({
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
}: ProjectItemProps) {
  const { t } = useTranslation();
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [renameDialogOpen, setRenameDialogOpen] = useState(false);
  const [moveDialogOpen, setMoveDialogOpen] = useState(false);
  const [generatingTitle, setGeneratingTitle] = useState(false);

  const date = new Date(project.createdAt);
  const dateStr = `${date.getMonth() + 1}/${date.getDate()} ${date.getHours()}:${String(date.getMinutes()).padStart(2, "0")}`;

  const handleClick = () => {
    if (project.isFolder && onToggleExpand) {
      onToggleExpand();
    } else {
      onClick();
    }
  };

  const handleAiGenerateTitle = async () => {
    const { segments } = useTranscriptionStore.getState();
    if (segments.length === 0) {
      toast.error(t("sidebar.noTranscriptForTitle"));
      return;
    }

    setGeneratingTitle(true);
    try {
      const transcriptText = segments.map((s) => s.text).join(" ");
      const title = await generateMeetingTitle(project.createdAt, transcriptText);
      onRename(title);
      toast.success(t("toast.summarySaved"));
    } catch {
      toast.error(t("sidebar.generateTitleFailed"));
    } finally {
      setGeneratingTitle(false);
    }
  };

  const FolderIconComp = isExpanded ? FolderOpen : Folder;
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
              <FolderIconComp className="h-3.5 w-3.5 shrink-0 text-amber-500" />
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
            {generatingTitle && (
              <Sparkles className="h-3 w-3 animate-pulse text-amber-500" />
            )}
          </div>
          {!project.isFolder && (
            <span className="ml-4 text-[11px] text-muted-foreground">
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
            {/* Folder-specific: create meeting / subfolder */}
            {project.isFolder && (
              <>
                <DropdownMenuItem
                  onClick={() => onCreateMeeting?.(project.id)}
                >
                  <FileText className="mr-2 h-3.5 w-3.5" />
                  {t("sidebar.newProject")}
                </DropdownMenuItem>
                {canCreateSubfolder && (
                  <DropdownMenuItem
                    onClick={() => onCreateSubfolder?.(project.id)}
                  >
                    <FolderPlus className="mr-2 h-3.5 w-3.5" />
                    {t("sidebar.newSubfolder")}
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
              </>
            )}

            {/* Meeting-specific: AI generate title */}
            {!project.isFolder && (
              <DropdownMenuItem
                onClick={handleAiGenerateTitle}
                disabled={generatingTitle}
              >
                <Sparkles className="mr-2 h-3.5 w-3.5" />
                {t("sidebar.aiGenerateTitle")}
              </DropdownMenuItem>
            )}

            {/* Common actions */}
            <DropdownMenuItem onClick={() => setRenameDialogOpen(true)}>
              <Pencil className="mr-2 h-3.5 w-3.5" />
              {t("sidebar.rename")}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setMoveDialogOpen(true)}>
              <Move className="mr-2 h-3.5 w-3.5" />
              {t("sidebar.moveTo")}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
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
        <AlertDialogContent
          onClick={(e: React.MouseEvent) => e.stopPropagation()}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>{t("action.delete")}</AlertDialogTitle>
            <AlertDialogDescription>
              {project.isFolder
                ? t("sidebar.deleteConfirm")
                : t("sidebar.deleteConfirmMeeting")}
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

      {/* Move dialog */}
      <MoveDialog
        open={moveDialogOpen}
        onClose={() => setMoveDialogOpen(false)}
        itemId={project.id}
      />
    </>
  );
}
