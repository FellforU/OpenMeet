import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Mic, Trash2 } from "lucide-react";
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
  AlertDialogTrigger,
} from "../ui/alert-dialog";
import { cn } from "@/lib/utils";
import type { Project } from "../../types";

interface ProjectItemProps {
  project: Project;
  isActive: boolean;
  onClick: () => void;
  onDelete: () => void;
}

export function ProjectItem({ project, isActive, onClick, onDelete }: ProjectItemProps) {
  const { t } = useTranslation();
  const [dialogOpen, setDialogOpen] = useState(false);
  const date = new Date(project.createdAt);
  const dateStr = `${date.getMonth() + 1}/${date.getDate()} ${date.getHours()}:${String(date.getMinutes()).padStart(2, "0")}`;

  return (
    <div
      onClick={onClick}
      className={cn(
        "mb-1 flex cursor-pointer items-center justify-between rounded-md border-l-[3px] px-3 py-2",
        isActive
          ? "border-l-primary bg-primary/10"
          : "border-l-transparent hover:bg-accent"
      )}
    >
      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          <Mic className="h-3 w-3 shrink-0 text-muted-foreground" />
          <span
            className={cn(
              "truncate text-[13px]",
              isActive && "font-semibold"
            )}
            style={{ maxWidth: 150 }}
          >
            {project.title}
          </span>
        </div>
        <span className="text-[11px] text-muted-foreground">{dateStr}</span>
      </div>
      <AlertDialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <AlertDialogTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0 opacity-50 hover:opacity-100"
            onClick={(e: React.MouseEvent) => e.stopPropagation()}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </AlertDialogTrigger>
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
                setDialogOpen(false);
              }}
            >
              {t("action.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
