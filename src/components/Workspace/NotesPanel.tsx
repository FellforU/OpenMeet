import { useState, useEffect, useRef, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";

interface Note {
  id: string;
  project_id: string;
  content: string;
  updated_at: string;
}

export function NotesPanel({ projectId }: { projectId: string }) {
  const { t } = useTranslation("workspace");
  const [content, setContent] = useState("");
  const [saveStatus, setSaveStatus] = useState<"saved" | "saving" | "idle">(
    "idle"
  );
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const projectIdRef = useRef(projectId);

  // Load note when project changes
  useEffect(() => {
    projectIdRef.current = projectId;
    invoke<Note | null>("db_get_note", { projectId }).then((note) => {
      setContent(note?.content || "");
      setSaveStatus("idle");
    });
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [projectId]);

  // Auto-save with debounce
  const handleChange = useCallback(
    (value: string) => {
      setContent(value);
      setSaveStatus("saving");

      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }

      timerRef.current = setTimeout(async () => {
        try {
          await invoke("db_save_note", {
            projectId: projectIdRef.current,
            content: value,
          });
          setSaveStatus("saved");
        } catch {
          // Retry silently
        }
      }, 1000);
    },
    []
  );

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-end px-4 py-1">
        <span className="text-xs text-muted-foreground">
          {saveStatus === "saving" && t("notes.saving")}
          {saveStatus === "saved" && t("notes.saved")}
        </span>
      </div>
      <textarea
        className="flex-1 resize-none border-0 bg-transparent px-4 pb-4 font-mono text-sm outline-none placeholder:text-muted-foreground/50"
        placeholder={t("notes.placeholder")}
        value={content}
        onChange={(e) => handleChange(e.target.value)}
      />
    </div>
  );
}
