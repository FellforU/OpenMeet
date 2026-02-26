import { useState, useRef, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Upload, FileAudio } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { Button } from "../ui/button";

const ACCEPT_TYPES =
  "audio/*,video/*,.mp3,.wav,.m4a,.mp4,.mkv,.flac,.ogg";

interface UploadDialogProps {
  open: boolean;
  onClose: () => void;
  onFileSelected: (file: File) => void;
}

export function UploadDialog({ open, onClose, onFileSelected }: UploadDialogProps) {
  const { t } = useTranslation();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  const handleFile = useCallback(
    (file: File) => {
      onFileSelected(file);
      onClose();
    },
    [onFileSelected, onClose]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    },
    [handleFile]
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) handleFile(file);
      e.target.value = "";
    },
    [handleFile]
  );

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
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
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
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload className="mr-1.5 h-4 w-4" />
            {t("upload.browse")}
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPT_TYPES}
            className="hidden"
            onChange={handleInputChange}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
