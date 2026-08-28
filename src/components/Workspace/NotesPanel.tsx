import { useState, useEffect, useRef, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { Pencil, Save, X, NotebookPen } from "lucide-react";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";
import { MilkdownEditor } from "../Editor";
import { indexProject } from "../../services/knowledgeClient";

interface Note {
  id: string;
  project_id: string;
  content: string;
  updated_at: string;
}

export function NotesPanel({ projectId }: { projectId: string }) {
  const { t } = useTranslation("workspace");
  const [content, setContent] = useState("");
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState("");
  const [saveStatus, setSaveStatus] = useState<"saved" | "saving" | "idle">("idle");
  const projectIdRef = useRef(projectId);

  useEffect(() => {
    projectIdRef.current = projectId;
    setEditing(false);
    invoke<Note | null>("db_get_note", { projectId }).then((note) => {
      setContent(note?.content || "");
      setSaveStatus("idle");
    });
  }, [projectId]);

  const save = useCallback(async (value: string) => {
    setSaveStatus("saving");
    try {
      await invoke("db_save_note", {
        projectId: projectIdRef.current,
        content: value,
      });
      setSaveStatus("saved");
      indexProject(projectIdRef.current).catch(() => {});
    } catch {
      setSaveStatus("idle");
    }
  }, []);

  const handleStartEdit = () => {
    setEditText(content);
    setEditing(true);
  };

  const handleSave = () => {
    setContent(editText);
    save(editText);
    setEditing(false);
  };

  const handleCancel = () => {
    setEditing(false);
    setEditText("");
  };

  const handleEditorChange = useCallback((markdown: string) => {
    setEditText(markdown);
  }, []);

  // Empty state
  if (!editing && !content) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
        <NotebookPen className="h-10 w-10" />
        <p className="text-sm">{t("notes.placeholder")}</p>
        <Button variant="outline" size="sm" onClick={handleStartEdit}>
          <Pencil className="mr-1.5 h-4 w-4" />
          {t("notes.startWriting")}
        </Button>
      </div>
    );
  }

  // Edit mode
  if (editing) {
    return (
      <div className="flex h-full flex-col">
        <div className="flex items-center gap-2 px-4 py-2">
          <Badge variant="secondary">{t("notes.editMode")}</Badge>
          <div className="ml-auto flex gap-2">
            <Button size="sm" onClick={handleSave}>
              <Save className="mr-1.5 h-4 w-4" />
              {t("common:action.save")}
            </Button>
            <Button variant="outline" size="sm" onClick={handleCancel}>
              <X className="mr-1.5 h-4 w-4" />
              {t("common:action.cancel")}
            </Button>
          </div>
        </div>
        <MilkdownEditor
          key={`edit-${projectId}`}
          defaultValue={editText}
          onChange={handleEditorChange}
        />
      </div>
    );
  }

  // View mode
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between px-4 py-2">
        <span className="text-xs text-muted-foreground">
          {saveStatus === "saving" && t("notes.saving")}
          {saveStatus === "saved" && t("notes.saved")}
        </span>
        <Button variant="outline" size="sm" onClick={handleStartEdit}>
          <Pencil className="mr-1.5 h-4 w-4" />
          {t("common:action.edit")}
        </Button>
      </div>
      <MilkdownEditor key={`view-${projectId}`} defaultValue={content} readonly />
    </div>
  );
}
