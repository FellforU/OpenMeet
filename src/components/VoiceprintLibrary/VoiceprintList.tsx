import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Pencil, Trash2, Merge, User } from "lucide-react";
import { toast } from "sonner";
import { Button } from "../ui/button";
import { cn } from "@/lib/utils";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
} from "../ui/alert-dialog";
import { VoiceprintEditDialog } from "./VoiceprintEditDialog";
import { useVoiceprintStore } from "../../stores/voiceprintStore";
import type { VoiceprintInfo, VoiceprintMetadata } from "../../types";

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "-";
  try {
    return new Date(dateStr).toLocaleDateString(undefined, {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return dateStr;
  }
}

export function VoiceprintList() {
  const { t } = useTranslation("settings");
  const {
    voiceprints,
    loading,
    loadVoiceprints,
    updateVoiceprint,
    deleteVoiceprint,
    mergeVoiceprints,
  } = useVoiceprintStore();

  const [editingVp, setEditingVp] = useState<VoiceprintInfo | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    loadVoiceprints();
  }, [loadVoiceprints]);

  const handleToggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    try {
      await deleteVoiceprint(deleteId);
      setSelected((prev) => {
        const next = new Set(prev);
        next.delete(deleteId);
        return next;
      });
      toast.success(t("voiceprint.deleteSuccess"));
    } catch {
      toast.error(t("voiceprint.deleteFailed"));
    }
    setDeleteId(null);
  };

  const handleMerge = async () => {
    const ids = Array.from(selected);
    if (ids.length !== 2) return;
    try {
      await mergeVoiceprints(ids[0], ids[1]);
      setSelected(new Set());
      toast.success(t("voiceprint.mergeSuccess"));
    } catch {
      toast.error(t("voiceprint.mergeFailed"));
    }
  };

  const handleSave = async (id: string, metadata: VoiceprintMetadata) => {
    await updateVoiceprint(id, metadata);
    toast.success(t("voiceprint.updateSuccess"));
  };

  if (loading && voiceprints.length === 0) {
    return (
      <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
        {t("voiceprint.loading")}
      </div>
    );
  }

  return (
    <div className="space-y-4 py-2">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold">{t("voiceprint.title")}</h3>
          <p className="text-xs text-muted-foreground">
            {t("voiceprint.subtitle")}
          </p>
        </div>
        {selected.size === 2 && (
          <Button variant="outline" size="sm" onClick={handleMerge}>
            <Merge className="mr-1.5 h-3.5 w-3.5" />
            {t("voiceprint.merge")}
          </Button>
        )}
      </div>

      {voiceprints.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 py-12 text-muted-foreground">
          <User className="h-10 w-10" />
          <p className="text-sm">{t("voiceprint.empty")}</p>
        </div>
      ) : (
        <div className="space-y-1">
          {voiceprints.map((vp) => (
            <div
              key={vp.id}
              className="flex items-center gap-3 rounded-md border px-3 py-2 hover:bg-muted/50"
            >
              <button
                className={cn(
                  "flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                  selected.has(vp.id)
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-muted-foreground/30"
                )}
                onClick={() => handleToggleSelect(vp.id)}
              >
                {selected.has(vp.id) && (
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                    <path d="M2 5L4 7L8 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                )}
              </button>
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                <User className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium">
                    {vp.name || t("voiceprint.unnamed")}
                  </span>
                  {vp.department && (
                    <span className="truncate text-xs text-muted-foreground">
                      {vp.department}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  <span>
                    {t("voiceprint.samples")}: {vp.sampleCount}
                  </span>
                  <span>
                    {t("voiceprint.lastSeen")}: {formatDate(vp.lastSeenAt)}
                  </span>
                </div>
              </div>
              <div className="flex shrink-0 gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7"
                  onClick={() => setEditingVp(vp)}
                >
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 text-destructive"
                  onClick={() => setDeleteId(vp.id)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <VoiceprintEditDialog
        open={editingVp !== null}
        voiceprint={editingVp}
        onClose={() => setEditingVp(null)}
        onSave={handleSave}
      />

      <AlertDialog open={deleteId !== null} onOpenChange={(v) => !v && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("voiceprint.deleteConfirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("voiceprint.deleteConfirmDesc")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common:action.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete}>
              {t("common:action.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
