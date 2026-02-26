import { useState, useEffect, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import {
  Paperclip,
  Trash2,
  ExternalLink,
  FileText,
  Image,
  File,
  Upload,
} from "lucide-react";
import { Button } from "../ui/button";

interface Attachment {
  id: string;
  project_id: string;
  filename: string;
  file_path: string;
  file_size: number;
  mime_type: string;
  created_at: string;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getFileIcon(mimeType: string) {
  if (mimeType.startsWith("image/")) return Image;
  if (
    mimeType === "application/pdf" ||
    mimeType.includes("document") ||
    mimeType === "text/plain" ||
    mimeType === "text/markdown"
  )
    return FileText;
  return File;
}

export function AttachmentsPanel({ projectId }: { projectId: string }) {
  const { t } = useTranslation("workspace");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    invoke<Attachment[]>("db_get_attachments", { projectId }).then(
      setAttachments
    );
  }, [projectId]);

  const handleUploadClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (!files) return;

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const path = (file as unknown as { path?: string }).path;
        if (!path) continue;
        try {
          const att = await invoke<Attachment>("db_add_attachment", {
            projectId,
            sourcePath: path,
          });
          setAttachments((prev) => [att, ...prev]);
        } catch {
          // Skip failed files
        }
      }
      // Reset input so same file can be selected again
      e.target.value = "";
    },
    [projectId]
  );

  const handleDelete = useCallback(async (id: string) => {
    await invoke("db_delete_attachment", { id });
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  }, []);

  const handleOpen = useCallback((id: string) => {
    invoke("db_open_attachment", { id });
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      const files = e.dataTransfer.files;
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const path = (file as unknown as { path?: string }).path;
        if (!path) continue;
        try {
          const att = await invoke<Attachment>("db_add_attachment", {
            projectId,
            sourcePath: path,
          });
          setAttachments((prev) => [att, ...prev]);
        } catch {
          // Skip failed files
        }
      }
    },
    [projectId]
  );

  const hiddenInput = (
    <input
      ref={fileInputRef}
      type="file"
      multiple
      className="hidden"
      onChange={handleFileChange}
    />
  );

  if (attachments.length === 0) {
    return (
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`flex h-full flex-col items-center justify-center gap-3 p-4 ${
          isDragging ? "bg-primary/5 ring-2 ring-primary ring-inset" : ""
        }`}
      >
        {hiddenInput}
        <Paperclip className="h-10 w-10 text-muted-foreground/40" />
        <p className="text-sm text-muted-foreground">
          {t("attachments.empty")}
        </p>
        <p className="text-xs text-muted-foreground/60">
          {t("attachments.dragHint")}
        </p>
        <Button variant="outline" size="sm" onClick={handleUploadClick}>
          <Upload className="mr-1.5 h-3.5 w-3.5" />
          {t("attachments.add")}
        </Button>
      </div>
    );
  }

  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={`flex h-full flex-col ${
        isDragging ? "bg-primary/5 ring-2 ring-primary ring-inset" : ""
      }`}
    >
      {hiddenInput}
      <div className="flex items-center justify-between border-b px-4 py-2">
        <span className="text-sm font-medium">
          {attachments.length} {t("tabs.attachments")}
        </span>
        <Button variant="outline" size="sm" onClick={handleUploadClick}>
          <Upload className="mr-1.5 h-3.5 w-3.5" />
          {t("attachments.add")}
        </Button>
      </div>
      <div className="flex-1 overflow-y-auto">
        {attachments.map((att) => {
          const IconComponent = getFileIcon(att.mime_type);
          return (
            <div
              key={att.id}
              className="flex items-center gap-3 border-b px-4 py-2.5 hover:bg-accent/50"
            >
              <IconComponent className="h-5 w-5 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm">{att.filename}</p>
                <p className="text-xs text-muted-foreground">
                  {formatFileSize(att.file_size)}
                  {" · "}
                  {new Date(att.created_at).toLocaleDateString()}
                </p>
              </div>
              <div className="flex shrink-0 gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0"
                  onClick={() => handleOpen(att.id)}
                  title={t("attachments.open")}
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                  onClick={() => handleDelete(att.id)}
                  title={t("attachments.deleteConfirm")}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
