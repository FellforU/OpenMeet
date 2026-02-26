import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Mic, Download, Bot, CheckCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";
import { Alert, AlertDescription } from "../ui/alert";
import logoHorizontal from "../../../ico/OpenMeet_logo3.png";

interface FirstRunGuideProps {
  open: boolean;
  onClose: () => void;
}

function WelcomeStep() {
  const { t } = useTranslation("guide");
  return (
    <div className="py-5 text-center">
      <img src={logoHorizontal} alt="OpenMeet" className="mx-auto mb-4 h-10 object-contain" />
      <h3 className="text-xl font-semibold">{t("welcome.title")}</h3>
      <p className="mt-2 text-sm text-muted-foreground">
        {t("welcome.description")}
      </p>
      <div className="mt-4 flex flex-wrap justify-center gap-2">
        <Badge variant="secondary">Offline transcription</Badge>
        <Badge variant="secondary">Multi-engine support</Badge>
        <Badge variant="secondary">AI-powered summaries</Badge>
      </div>
    </div>
  );
}

function MicrophoneStep() {
  const { t } = useTranslation("guide");
  return (
    <div className="py-4">
      <h4 className="flex items-center gap-2 text-lg font-semibold">
        <Mic className="h-5 w-5" />
        {t("microphone.title")}
      </h4>
      <p className="mt-2 text-sm text-muted-foreground">
        OpenMeet needs microphone access for real-time transcription.
        You can also transcribe uploaded audio files without a microphone.
      </p>
      <Alert className="mt-3">
        <AlertDescription>{t("microphone.description")}</AlertDescription>
      </Alert>
    </div>
  );
}

function ModelStep() {
  const { t } = useTranslation("guide");
  return (
    <div className="py-4">
      <h4 className="flex items-center gap-2 text-lg font-semibold">
        <Download className="h-5 w-5" />
        {t("model.title")}
      </h4>
      <p className="mt-2 text-sm text-muted-foreground">
        {t("model.description")}
      </p>
      <div className="mt-3 space-y-2">
        <div className="rounded-md border-2 border-green-200 bg-green-50 p-3">
          <p className="font-medium">Recommended: Whisper Base</p>
          <p className="text-sm text-muted-foreground">1.5 GB VRAM - Good balance of speed and accuracy</p>
        </div>
        <div className="rounded-md border border-border p-3">
          <p className="font-medium">Whisper Tiny</p>
          <p className="text-sm text-muted-foreground">1 GB VRAM - Fastest, for low-end hardware</p>
        </div>
        <div className="rounded-md border border-border p-3">
          <p className="font-medium">Qwen3-ASR 0.6B (Chinese)</p>
          <p className="text-sm text-muted-foreground">3 GB VRAM - Best for Chinese and dialects</p>
        </div>
      </div>
    </div>
  );
}

function OllamaStep() {
  const { t } = useTranslation("guide");
  return (
    <div className="py-4">
      <h4 className="flex items-center gap-2 text-lg font-semibold">
        <Bot className="h-5 w-5" />
        {t("ollama.title")}
      </h4>
      <p className="mt-2 text-sm text-muted-foreground">
        {t("ollama.description")}
      </p>
      <Alert className="mt-3">
        <AlertDescription>
          {t("ollama.instruction")}
        </AlertDescription>
      </Alert>
    </div>
  );
}

function DoneStep() {
  const { t } = useTranslation("guide");
  return (
    <div className="flex flex-col items-center gap-3 py-8">
      <CheckCircle className="h-12 w-12 text-green-500" />
      <h3 className="text-xl font-semibold">{t("done.title")}</h3>
      <p className="text-sm text-muted-foreground">
        {t("done.description")}
      </p>
    </div>
  );
}

const STEPS = [
  { key: "welcome", content: <WelcomeStep /> },
  { key: "microphone", content: <MicrophoneStep /> },
  { key: "model", content: <ModelStep /> },
  { key: "ollama", content: <OllamaStep /> },
  { key: "done", content: <DoneStep /> },
];

export function FirstRunGuide({ open, onClose }: FirstRunGuideProps) {
  const { t } = useTranslation("guide");
  const [current, setCurrent] = useState(0);

  const isLast = current === STEPS.length - 1;

  const handleNext = () => {
    if (isLast) {
      onClose();
      setCurrent(0);
    } else {
      setCurrent(current + 1);
    }
  };

  const handlePrev = () => {
    setCurrent(Math.max(0, current - 1));
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Getting Started</DialogTitle>
        </DialogHeader>

        {/* Step indicator */}
        <div className="flex items-center justify-center gap-2">
          {STEPS.map((step, i) => (
            <div key={step.key} className="flex items-center">
              {i > 0 && (
                <div
                  className={cn(
                    "mx-1 h-px w-6",
                    i <= current ? "bg-primary" : "bg-border"
                  )}
                />
              )}
              <div
                className={cn(
                  "flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium",
                  i < current && "bg-primary text-primary-foreground",
                  i === current && "bg-primary text-primary-foreground ring-2 ring-primary/30",
                  i > current && "bg-muted text-muted-foreground"
                )}
              >
                {i + 1}
              </div>
            </div>
          ))}
        </div>

        {STEPS[current].content}

        <DialogFooter className="flex justify-between sm:justify-between">
          <Button variant="ghost" onClick={onClose}>
            {t("common:action.skip")}
          </Button>
          <div className="flex gap-2">
            {current > 0 && (
              <Button variant="outline" onClick={handlePrev}>
                {t("common:action.previous")}
              </Button>
            )}
            <Button onClick={handleNext}>
              {isLast ? t("done.getStarted") : t("common:action.next")}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
