import { Button, Space, Upload, message } from "antd";
import {
  UploadOutlined,
  AudioOutlined,
  ExportOutlined,
} from "@ant-design/icons";
import { useTranscriptionStore } from "../../stores/transcriptionStore";
import { useProjectStore } from "../../stores/projectStore";

export function ActionButtons() {
  const { setAudioFile, startTranscription, job } = useTranscriptionStore();
  const activeProjectId = useProjectStore((s) => s.activeProjectId);
  const updateProject = useProjectStore((s) => s.updateProject);

  const handleUpload = (file: File) => {
    const objectUrl = URL.createObjectURL(file);
    // For Tauri, we use the actual file path
    // For dev, use object URL as fallback
    const filePath = (file as unknown as { path?: string }).path || file.name;
    setAudioFile(filePath, objectUrl);

    if (activeProjectId) {
      updateProject(activeProjectId, { audioPath: filePath });
    }

    message.success(`Loaded: ${file.name}`);

    // Auto-start transcription
    startTranscription("whisper", "base", null);

    return false; // prevent default upload
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
      <Button
        icon={<AudioOutlined />}
        disabled
        title="Real-time recording (Phase 2)"
      >
        Record
      </Button>
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
