import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Upload, FileAudio } from "lucide-react";
import { toast } from "sonner";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { Button } from "../ui/button";

const AUDIO_EXTENSIONS = new Set([
  "mp3", "wav", "m4a", "mp4", "mkv", "flac", "ogg", "webm", "aac",
]);

function isAudioFile(path: string): boolean {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return AUDIO_EXTENSIONS.has(ext);
}

interface UploadDialogProps {
  open: boolean;
  onClose: () => void;
  onFileSelected: (filePath: string) => void;
}

export function UploadDialog({ open, onClose, onFileSelected }: UploadDialogProps) {
  const { t } = useTranslation();
  const [isDragging, setIsDragging] = useState(false);

  const handleFilePath = useCallback(
    (filePath: string) => {
      onFileSelected(filePath);
      onClose();
    },
    [onFileSelected, onClose]
  );

  // Listen for Tauri native drag-drop events (provides full file paths)
  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    let unlisten: (() => void) | null = null;

    getCurrentWebview()
      .onDragDropEvent((event) => {
        if (cancelled) return;

        if (event.payload.type === "enter" || event.payload.type === "over") {
          setIsDragging(true);
        } else if (event.payload.type === "leave") {
          setIsDragging(false);
        } else if (event.payload.type === "drop") {
          setIsDragging(false);
          const audioPath = event.payload.paths.find(isAudioFile);
          if (audioPath) {
            handleFilePath(audioPath);
          } else if (event.payload.paths.length > 0) {
            toast.warning(t("upload.unsupportedFormat"));
          }
        }
      })
      .then((fn) => {
        if (cancelled) {
          fn();
        } else {
          unlisten = fn;
        }
      });

    return () => {
      cancelled = true;
      setIsDragging(false);
      unlisten?.();
    };
  }, [open, handleFilePath, t]);

  // Click upload: open native file picker via Rust IPC
  const handleBrowse = useCallback(async () => {
    try {
      const path = await invoke<string | null>("pick_audio_file");
      if (path) {
        handleFilePath(path);
      }
    } catch {
      // User cancelled or dialog error — ignore
    }
  }, [handleFilePath]);

  // Prevent browser default drag behavior to let Tauri handle it
  const preventDefaults = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("upload.title")}</DialogTitle>
        </DialogHeader>

        <div
          className={`mt-2 flex flex-col items-center justify-center rounded-lg border-2 border-dashed px-6 py-10 transition-colors ${
            isDragging
              ? "border-primary bg-primary/5"
              : "border-muted-foreground/25 hover:border-muted-foreground/50"
          }`}
          onDragOver={preventDefaults}
          onDrop={preventDefaults}
        >
          <FileAudio className="mb-3 h-10 w-10 text-muted-foreground" />
          <p className="mb-1 text-sm font-medium">
            {t("upload.dragHint")}
          </p>
          <p className="mb-4 text-xs text-muted-foreground">
            MP3, WAV, M4A, FLAC, OGG, MP4, MKV
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={handleBrowse}
          >
            <Upload className="mr-1.5 h-4 w-4" />
            {t("upload.browse")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
