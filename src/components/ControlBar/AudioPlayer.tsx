import { useRef, useEffect } from "react";
import { Button, Slider, Space, Typography } from "antd";
import {
  PlayCircleOutlined,
  PauseCircleOutlined,
  StepBackwardOutlined,
  StepForwardOutlined,
} from "@ant-design/icons";
import { useTranscriptionStore } from "../../stores/transcriptionStore";

const { Text } = Typography;

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function AudioPlayer() {
  const audioRef = useRef<HTMLAudioElement>(null);
  const {
    audio,
    setIsPlaying,
    setCurrentTime,
    setDuration,
    setPlaybackSpeed: _setPlaybackSpeed,
  } = useTranscriptionStore();

  useEffect(() => {
    if (!audioRef.current || !audio.objectUrl) return;
    audioRef.current.src = audio.objectUrl;
  }, [audio.objectUrl]);

  useEffect(() => {
    if (!audioRef.current) return;
    audioRef.current.playbackRate = audio.playbackSpeed;
  }, [audio.playbackSpeed]);

  // Sync external seekTo calls
  useEffect(() => {
    if (!audioRef.current) return;
    const diff = Math.abs(audioRef.current.currentTime - audio.currentTime);
    if (diff > 1) {
      audioRef.current.currentTime = audio.currentTime;
      if (!audio.isPlaying) {
        audioRef.current.play();
        setIsPlaying(true);
      }
    }
  }, [audio.currentTime, audio.isPlaying, setIsPlaying]);

  const togglePlay = () => {
    if (!audioRef.current) return;
    if (audio.isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
    } else {
      audioRef.current.play();
      setIsPlaying(true);
    }
  };

  const skip = (delta: number) => {
    if (!audioRef.current) return;
    audioRef.current.currentTime += delta;
  };

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, flex: 1 }}>
      <audio
        ref={audioRef}
        onTimeUpdate={() => {
          if (audioRef.current) setCurrentTime(audioRef.current.currentTime);
        }}
        onLoadedMetadata={() => {
          if (audioRef.current) setDuration(audioRef.current.duration);
        }}
        onEnded={() => setIsPlaying(false)}
      />
      <Space size={4}>
        <Button
          type="text"
          size="small"
          icon={<StepBackwardOutlined />}
          onClick={() => skip(-5)}
          disabled={!audio.objectUrl}
        />
        <Button
          type="text"
          icon={audio.isPlaying ? <PauseCircleOutlined /> : <PlayCircleOutlined />}
          onClick={togglePlay}
          disabled={!audio.objectUrl}
          style={{ fontSize: 20 }}
        />
        <Button
          type="text"
          size="small"
          icon={<StepForwardOutlined />}
          onClick={() => skip(5)}
          disabled={!audio.objectUrl}
        />
      </Space>
      <Slider
        style={{ flex: 1, margin: "0 8px" }}
        min={0}
        max={audio.duration || 100}
        step={0.1}
        value={audio.currentTime}
        onChange={(val) => {
          if (audioRef.current) audioRef.current.currentTime = val;
          setCurrentTime(val);
        }}
        tooltip={{ formatter: (val) => formatTime(val || 0) }}
        disabled={!audio.objectUrl}
      />
      <Text style={{ fontSize: 12, whiteSpace: "nowrap" }}>
        {formatTime(audio.currentTime)} / {formatTime(audio.duration)}
      </Text>
    </div>
  );
}
