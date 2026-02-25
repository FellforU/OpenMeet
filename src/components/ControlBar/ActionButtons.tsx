import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { Upload, FileDown } from "lucide-react";
import { toast } from "sonner";
import { Button } from "../ui/button";
import { useTranscriptionStore } from "../../stores/transcriptionStore";
import { useProjectStore } from "../../stores/projectStore";
import { useEngineStore } from "../../stores/engineStore";
import { RecordButton } from "./RecordButton";

export function ActionButtons() {
  const { t } = useTranslation();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { setAudioFile, startTranscription, job } = useTranscriptionStore();
  const activeProjectId = useProjectStore((s) => s.activeProjectId);
  const updateProject = useProjectStore((s) => s.updateProject);
  const { selectedEngine, selectedModelSize, selectedLanguage } =
    useEngineStore();

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const objectUrl = URL.createObjectURL(file);
    const filePath = (file as unknown as { path?: string }).path || file.name;
    setAudioFile(filePath, objectUrl);

    if (activeProjectId) {
      updateProject(activeProjectId, { audioPath: filePath });
    }

    toast.success(t("toast.fileLoaded", { name: file.name }));

    const lang = selectedLanguage === "auto" ? null : selectedLanguage;
    startTranscription(selectedEngine, selectedModelSize, lang);

    // Reset input so the same file can be re-selected
    e.target.value = "";
  };

  return (
    <div className="flex items-center gap-2">
      <input
        ref={fileInputRef}
        type="file"
        accept="audio/*,video/*,.mp3,.wav,.m4a,.mp4,.mkv,.flac,.ogg"
        className="hidden"
        onChange={handleFileChange}
      />
      <Button
        variant="outline"
        size="sm"
        onClick={() => fileInputRef.current?.click()}
        disabled={job.status === "running"}
      >
        <Upload className="mr-1.5 h-4 w-4" />
        {t("action.upload")}
      </Button>
      <RecordButton />
      <Button variant="outline" size="sm" disabled title="Export (Phase 3)">
        <FileDown className="mr-1.5 h-4 w-4" />
        {t("action.export")}
      </Button>
    </div>
  );
}
