import { useRef, useEffect } from "react";
import { Play, Pause, SkipBack, SkipForward, FolderOpen } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { Button } from "../ui/button";
import { Slider } from "../ui/slider";
import { useTranscriptionStore } from "../../stores/transcriptionStore";

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function AudioPlayer() {
  const { t } = useTranslation();
  const audioRef = useRef<HTMLAudioElement>(null);
  const {
    audio,
    setIsPlaying,
    setCurrentTime,
    setDuration,
  } = useTranscriptionStore();

  useEffect(() => {
    if (!audioRef.current || !audio.objectUrl) return;
    audioRef.current.src = audio.objectUrl;
  }, [audio.objectUrl]);

  useEffect(() => {
    if (!audioRef.current) return;
    audioRef.current.playbackRate = audio.playbackSpeed;
  }, [audio.playbackSpeed]);

  useEffect(() => {
    if (!audioRef.current) return;
    const diff = Math.abs(audioRef.current.currentTime - audio.currentTime);
    if (diff > 1) {
      audioRef.current.currentTime = audio.currentTime;
      if (audio.isPlaying && audioRef.current.paused) {
        audioRef.current.play();
      }
    }
  }, [audio.currentTime, audio.isPlaying]);

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
    <div className="flex flex-1 items-center gap-3">
      <audio
        ref={audioRef}
        onTimeUpdate={() => {
          if (audioRef.current) setCurrentTime(audioRef.current.currentTime);
        }}
        onLoadedMetadata={() => {
          if (audioRef.current) setDuration(audioRef.current.duration);
        }}
        onEnded={() => setIsPlaying(false)}
        onError={() => {
          if (audio.objectUrl) {
            toast.error(t("error.audioLoadFailed"));
          }
        }}
      />
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0"
          onClick={() => skip(-5)}
          disabled={!audio.objectUrl}
        >
          <SkipBack className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 w-8 p-0"
          onClick={togglePlay}
          disabled={!audio.objectUrl}
        >
          {audio.isPlaying ? (
            <Pause className="h-5 w-5" />
          ) : (
            <Play className="h-5 w-5" />
          )}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0"
          onClick={() => skip(5)}
          disabled={!audio.objectUrl}
        >
          <SkipForward className="h-4 w-4" />
        </Button>
      </div>
      <Slider
        className="flex-1"
        min={0}
        max={audio.duration || 100}
        step={0.1}
        value={[audio.currentTime]}
        onValueChange={(val: number[]) => {
          if (audioRef.current) audioRef.current.currentTime = val[0];
          setCurrentTime(val[0]);
        }}
        disabled={!audio.objectUrl}
      />
      <span className="whitespace-nowrap text-xs text-muted-foreground">
        {formatTime(audio.currentTime)} / {formatTime(audio.duration)}
      </span>
      {audio.filePath && (
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 shrink-0 p-0"
          title={audio.filePath}
          onClick={() =>
            invoke("reveal_file", { path: audio.filePath }).catch(() =>
              toast.error(t("error.audioLoadFailed"))
            )
          }
        >
          <FolderOpen className="h-3.5 w-3.5" />
        </Button>
      )}
    </div>
  );
}
