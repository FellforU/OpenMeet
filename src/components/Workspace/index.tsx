import { useState } from "react";
import { useTranslation } from "react-i18next";
import { FileText, Lightbulb, NotebookPen, Paperclip, GitBranch } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs";
import { TranscriptPanel } from "./TranscriptPanel";
import { SummaryPanel } from "./SummaryPanel";
import { NotesPanel } from "./NotesPanel";
import { MindMapPanel } from "./MindMapPanel";
import { AttachmentsPanel } from "./AttachmentsPanel";
import { ExportButton } from "./ExportButton";
import { useTranscriptionStore } from "../../stores/transcriptionStore";
import { useProjectStore } from "../../stores/projectStore";

export function Workspace() {
  const { t } = useTranslation("workspace");
  const seekTo = useTranscriptionStore((s) => s.seekTo);
  const activeProjectId = useProjectStore((s) => s.activeProjectId);
  const [activeTab, setActiveTab] = useState("transcript");

  const handleJumpToTranscript = (time: number) => {
    seekTo(time);
    setActiveTab("transcript");
  };

  return (
    <Tabs value={activeTab} onValueChange={setActiveTab} className="flex h-full flex-col">
      <div className="mx-4 mt-1 flex items-center justify-between">
        <TabsList className="w-fit">
          <TabsTrigger value="transcript" className="gap-1.5">
            <FileText className="h-3.5 w-3.5" />
            {t("tabs.transcript")}
          </TabsTrigger>
          <TabsTrigger value="summary" className="gap-1.5">
            <Lightbulb className="h-3.5 w-3.5" />
            {t("tabs.summary")}
          </TabsTrigger>
          <TabsTrigger value="notes" className="gap-1.5">
            <NotebookPen className="h-3.5 w-3.5" />
            {t("tabs.notes")}
          </TabsTrigger>
          <TabsTrigger value="mindmap" className="gap-1.5">
            <GitBranch className="h-3.5 w-3.5" />
            {t("tabs.mindmap")}
          </TabsTrigger>
          <TabsTrigger value="attachments" className="gap-1.5">
            <Paperclip className="h-3.5 w-3.5" />
            {t("tabs.attachments")}
          </TabsTrigger>
        </TabsList>
        <ExportButton />
      </div>
      <TabsContent value="transcript" className="flex-1 overflow-hidden">
        <TranscriptPanel />
      </TabsContent>
      <TabsContent value="summary" className="flex-1 overflow-hidden">
        <SummaryPanel onJumpToTranscript={handleJumpToTranscript} />
      </TabsContent>
      <TabsContent value="notes" className="flex-1 overflow-hidden">
        {activeProjectId ? (
          <NotesPanel projectId={activeProjectId} />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            {t("notes.placeholder")}
          </div>
        )}
      </TabsContent>
      <TabsContent value="mindmap" className="flex-1 overflow-hidden">
        <MindMapPanel />
      </TabsContent>
      <TabsContent value="attachments" className="flex-1 overflow-hidden">
        {activeProjectId ? (
          <AttachmentsPanel projectId={activeProjectId} />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            {t("attachments.empty")}
          </div>
        )}
      </TabsContent>
    </Tabs>
  );
}
