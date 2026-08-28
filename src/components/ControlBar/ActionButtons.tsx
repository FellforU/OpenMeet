import { useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "../ui/button";
import { useTranscriptionStore } from "../../stores/transcriptionStore";
import { useProjectStore } from "../../stores/projectStore";
import { useEngineStore } from "../../stores/engineStore";
import { loadAudioUrl } from "../../services/audioLoader";
import { RecordButton } from "./RecordButton";
import { UploadDialog } from "./UploadDialog";

export function ActionButtons() {
  const { t } = useTranslation();
  const { setAudioFile, startTranscription, job } = useTranscriptionStore();
  const activeProjectId = useProjectStore((s) => s.activeProjectId);
  const updateProject = useProjectStore((s) => s.updateProject);
  const { selectedEngine, selectedModelSize, selectedLanguage } =
    useEngineStore();
  const [uploadOpen, setUploadOpen] = useState(false);

  const handleFileSelected = useCallback(
    async (filePath: string) => {
      const objectUrl = await loadAudioUrl(filePath);
      if (!objectUrl) {
        toast.error(t("error.audioLoadFailed"));
        return;
      }

      setAudioFile(filePath, objectUrl);

      if (activeProjectId) {
        updateProject(activeProjectId, { audioPath: filePath });
      }

      const fileName = filePath.split(/[/\\]/).pop() ?? filePath;
      toast.success(t("toast.fileLoaded", { name: fileName }));

      const lang = selectedLanguage === "auto" ? null : selectedLanguage;
      startTranscription(selectedEngine, selectedModelSize, lang);
    },
    [
      t,
      setAudioFile,
      activeProjectId,
      updateProject,
      selectedEngine,
      selectedModelSize,
      selectedLanguage,
      startTranscription,
    ]
  );

  return (
    <div className="flex items-center gap-2">
      <Button
        variant="outline"
        size="sm"
        onClick={() => setUploadOpen(true)}
        disabled={job.status === "running"}
      >
        <Upload className="mr-1.5 h-4 w-4" />
        {t("action.upload")}
      </Button>
      <RecordButton />

      <UploadDialog
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        onFileSelected={handleFileSelected}
      />
    </div>
  );
}
