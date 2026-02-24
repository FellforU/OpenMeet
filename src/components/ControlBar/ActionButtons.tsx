import { Button, Space, Upload, message } from "antd";
import { UploadOutlined, ExportOutlined } from "@ant-design/icons";
import { useTranscriptionStore } from "../../stores/transcriptionStore";
import { useProjectStore } from "../../stores/projectStore";
import { useEngineStore } from "../../stores/engineStore";
import { RecordButton } from "./RecordButton";

export function ActionButtons() {
  const { setAudioFile, startTranscription, job } = useTranscriptionStore();
  const activeProjectId = useProjectStore((s) => s.activeProjectId);
  const updateProject = useProjectStore((s) => s.updateProject);
  const { selectedEngine, selectedModelSize, selectedLanguage } =
    useEngineStore();

  const handleUpload = (file: File) => {
    const objectUrl = URL.createObjectURL(file);
    const filePath = (file as unknown as { path?: string }).path || file.name;
    setAudioFile(filePath, objectUrl);

    if (activeProjectId) {
      updateProject(activeProjectId, { audioPath: filePath });
    }

    message.success(`Loaded: ${file.name}`);

    const lang = selectedLanguage === "auto" ? null : selectedLanguage;
    startTranscription(selectedEngine, selectedModelSize, lang);

    return false;
  };

  return (
    <Space>
      <Upload
        accept="audio/*,video/*,.mp3,.wav,.m4a,.mp4,.mkv,.flac,.ogg"
        showUploadList={false}
        beforeUpload={handleUpload}
      >
        <Button
          icon={<UploadOutlined />}
          disabled={job.status === "running"}
        >
          Upload
        </Button>
      </Upload>
      <RecordButton />
      <Button
        icon={<ExportOutlined />}
        disabled
        title="Export (Phase 3)"
      >
        Export
      </Button>
    </Space>
  );
}
