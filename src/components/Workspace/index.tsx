import { useState } from "react";
import { useTranslation } from "react-i18next";
import { FileText, Lightbulb } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs";
import { TranscriptPanel } from "./TranscriptPanel";
import { SummaryPanel } from "./SummaryPanel";
import { useTranscriptionStore } from "../../stores/transcriptionStore";

export function Workspace() {
  const { t } = useTranslation("workspace");
  const seekTo = useTranscriptionStore((s) => s.seekTo);
  const [activeTab, setActiveTab] = useState("transcript");

  const handleJumpToTranscript = (time: number) => {
    seekTo(time);
    setActiveTab("transcript");
  };

  return (
    <Tabs value={activeTab} onValueChange={setActiveTab} className="flex h-full flex-col">
      <TabsList className="mx-4 mt-1 w-fit">
        <TabsTrigger value="transcript" className="gap-1.5">
          <FileText className="h-3.5 w-3.5" />
          {t("tabs.transcript")}
        </TabsTrigger>
        <TabsTrigger value="summary" className="gap-1.5">
          <Lightbulb className="h-3.5 w-3.5" />
          {t("tabs.summary")}
        </TabsTrigger>
      </TabsList>
      <TabsContent value="transcript" className="flex-1 overflow-hidden">
        <TranscriptPanel />
      </TabsContent>
      <TabsContent value="summary" className="flex-1 overflow-hidden">
        <SummaryPanel onJumpToTranscript={handleJumpToTranscript} />
      </TabsContent>
    </Tabs>
  );
}
