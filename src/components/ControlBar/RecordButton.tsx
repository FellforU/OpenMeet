import { Button, Space, Typography } from "antd";
import { AudioOutlined, PauseOutlined, BorderOutlined } from "@ant-design/icons";
import { useRecordingStore } from "../../stores/recordingStore";
import { useEngineStore } from "../../stores/engineStore";

const { Text } = Typography;

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function RecordButton() {
  const { status, elapsed, startRecording, pauseRecording, resumeRecording, stopRecording } =
    useRecordingStore();
  const { selectedEngine, selectedModelSize, selectedLanguage } =
    useEngineStore();

  const handleStart = () => {
    const lang = selectedLanguage === "auto" ? null : selectedLanguage;
    startRecording(selectedEngine, selectedModelSize, lang);
  };

  if (status === "idle") {
    return (
      <Button icon={<AudioOutlined />} onClick={handleStart}>
        Record
      </Button>
    );
  }

  return (
    <Space size={4}>
      {status === "recording" ? (
        <Button icon={<PauseOutlined />} onClick={pauseRecording}>
          Pause
        </Button>
      ) : (
        <Button icon={<AudioOutlined />} onClick={resumeRecording}>
          Resume
        </Button>
      )}
      <Button
        icon={<BorderOutlined />}
        danger
        onClick={stopRecording}
      >
        Stop
      </Button>
      <Text
        type={status === "recording" ? "danger" : "secondary"}
        style={{ fontSize: 12, fontVariantNumeric: "tabular-nums" }}
      >
        {status === "recording" ? "● " : "⏸ "}
        {formatElapsed(elapsed)}
      </Text>
    </Space>
  );
}
