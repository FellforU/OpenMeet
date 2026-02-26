import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Folder, FolderOpen, ChevronRight, ChevronDown } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { Button } from "../ui/button";
import { cn } from "@/lib/utils";
import { useProjectStore } from "../../stores/projectStore";

interface MoveDialogProps {
  open: boolean;
  onClose: () => void;
  itemId: string;
}

export function MoveDialog({ open, onClose, itemId }: MoveDialogProps) {
  const { t } = useTranslation();
  const { projects, moveItem, getItemDepth, getDescendantIds } =
    useProjectStore();
  const [selectedTarget, setSelectedTarget] = useState<string | null | undefined>(undefined);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // Reset state when dialog opens or itemId changes
  useEffect(() => {
    if (open) {
      setSelectedTarget(undefined);
      setExpanded(new Set());
    }
  }, [open, itemId]);

  const item = projects.find((p) => p.id === itemId);
  if (!item) return null;

  const descendantIds = new Set(getDescendantIds(itemId));

  const toggleExpand = (folderId: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(folderId)) {
        next.delete(folderId);
      } else {
        next.add(folderId);
      }
      return next;
    });
  };

  const isValidTarget = (targetId: string | null): boolean => {
    // Cannot move to current parent (no-op)
    if (targetId === (item.parentId ?? null)) return false;
    // Cannot move to self
    if (targetId === itemId) return false;
    // Cannot move to descendant
    if (targetId !== null && descendantIds.has(targetId)) return false;
    // Check depth constraint for folders (including subtree depth)
    if (item.isFolder && targetId !== null) {
      const targetDepth = getItemDepth(targetId);
      // Calculate subtree height of the moved folder
      const itemDepth = getItemDepth(itemId);
      let maxDescDepth = itemDepth;
      for (const descId of descendantIds) {
        const d = getItemDepth(descId);
        if (d > maxDescDepth) maxDescDepth = d;
      }
      const subtreeHeight = maxDescDepth - itemDepth;
      if (targetDepth + 1 + subtreeHeight > 2) return false;
    }
    return true;
  };

  const handleConfirm = () => {
    if (selectedTarget === undefined) return;
    moveItem(itemId, selectedTarget);
    onClose();
  };

  const renderFolderTree = (parentId: string | null, level: number) => {
    const folders = projects.filter(
      (p) => p.isFolder && (p.parentId ?? null) === parentId
    );

    return folders.map((folder) => {
      const isExp = expanded.has(folder.id);
      const valid = isValidTarget(folder.id);
      const isCurrent = (item.parentId ?? null) === folder.id;
      const FolderIcon = isExp ? FolderOpen : Folder;
      const ChevronIcon = isExp ? ChevronDown : ChevronRight;
      const hasChildren = projects.some(
        (p) => p.isFolder && p.parentId === folder.id
      );

      return (
        <div key={folder.id}>
          <div
            onClick={() => valid && setSelectedTarget(folder.id)}
            style={{ paddingLeft: level * 20 + 8 }}
            className={cn(
              "flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-1.5 text-sm",
              selectedTarget === folder.id && "bg-primary/10 ring-1 ring-primary",
              !valid && "cursor-not-allowed opacity-40",
              isCurrent && "text-muted-foreground"
            )}
          >
            {hasChildren ? (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  toggleExpand(folder.id);
                }}
                className="p-0"
              >
                <ChevronIcon className="h-3 w-3" />
              </button>
            ) : (
              <span className="w-3" />
            )}
            <FolderIcon className="h-4 w-4 text-amber-500" />
            <span className="truncate">{folder.title}</span>
            {isCurrent && (
              <span className="ml-auto text-xs text-muted-foreground">
                (current)
              </span>
            )}
          </div>
          {isExp && renderFolderTree(folder.id, level + 1)}
        </div>
      );
    });
  };

  const rootValid = isValidTarget(null);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-[360px]">
        <DialogHeader>
          <DialogTitle>{t("sidebar.moveTitle")}</DialogTitle>
        </DialogHeader>
        <div className="max-h-[300px] overflow-y-auto rounded-md border p-2">
          {/* Root level option */}
          <div
            onClick={() => rootValid && setSelectedTarget(null)}
            className={cn(
              "flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-1.5 text-sm",
              selectedTarget === null && "bg-primary/10 ring-1 ring-primary",
              !rootValid && "cursor-not-allowed opacity-40"
            )}
          >
            <Folder className="h-4 w-4 text-muted-foreground" />
            <span>{t("sidebar.rootLevel")}</span>
            {item.parentId === null && (
              <span className="ml-auto text-xs text-muted-foreground">
                (current)
              </span>
            )}
          </div>
          {renderFolderTree(null, 1)}
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose}>
            {t("action.cancel")}
          </Button>
          <Button
            size="sm"
            onClick={handleConfirm}
            disabled={selectedTarget === undefined}
          >
            {t("action.confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
