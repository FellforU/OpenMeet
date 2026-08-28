import { useState } from "react";
import { useTranslation } from "react-i18next";
import { FileText, Lightbulb, NotebookPen, Paperclip, GitBranch, Pencil, Download } from "lucide-react";
import { toast } from "sonner";
import { Button } from "../ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs";
import { TranscriptPanel } from "./TranscriptPanel";
import { SummaryPanel } from "./SummaryPanel";
import { NotesPanel } from "./NotesPanel";
import { MindMapPanel } from "./MindMapPanel";
import { AttachmentsPanel } from "./AttachmentsPanel";
import { ExportButton, saveXMindViaDialog } from "./ExportButton";
import { summaryToXMind } from "./mindmapUtils";
import { useTranscriptionStore } from "../../stores/transcriptionStore";
import { useProjectStore } from "../../stores/projectStore";
import { useRecordingStore } from "../../stores/recordingStore";

export function Workspace() {
  const { t } = useTranslation("workspace");
  const seekTo = useTranscriptionStore((s) => s.seekTo);
  const summary = useTranscriptionStore((s) => s.summary);
  const hasSegments = useTranscriptionStore((s) => s.segments.length > 0);
  const isRecording = useRecordingStore((s) => s.status === "recording");
  const activeProjectId = useProjectStore((s) => s.activeProjectId);
  const [activeTab, setActiveTab] = useState("transcript");
  const [transcriptEditing, setTranscriptEditing] = useState(false);
  const [summaryEditing, setSummaryEditing] = useState(false);

  const handleJumpToTranscript = (time: number) => {
    seekTo(time);
    setActiveTab("transcript");
  };

  const handleExportXMind = async () => {
    if (!summary) return;
    try {
      const data = await summaryToXMind(summary);
      const timestamp = new Date().toISOString().slice(0, 10);
      const path = await saveXMindViaDialog(data, `mindmap-${timestamp}.xmind`);
      if (path) {
        toast.success(t("export.successPath", { path }));
      }
    } catch (error) {
      console.error("XMind export failed:", error);
      toast.error(t("export.failed"));
    }
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
        <div className="flex items-center gap-2">
          {activeTab === "transcript" && hasSegments && !isRecording && !transcriptEditing && (
            <Button variant="outline" size="sm" onClick={() => setTranscriptEditing(true)}>
              <Pencil className="mr-1.5 h-4 w-4" />
              {t("common:action.edit")}
            </Button>
          )}
          {activeTab === "summary" && summary && !summaryEditing && (
            <Button variant="outline" size="sm" onClick={() => setSummaryEditing(true)}>
              <Pencil className="mr-1.5 h-4 w-4" />
              {t("summary.editSummary")}
            </Button>
          )}
          {activeTab === "mindmap" && summary && (
            <Button variant="outline" size="sm" onClick={handleExportXMind}>
              <Download className="mr-1.5 h-4 w-4" />
              {t("mindmap.exportXmind")}
            </Button>
          )}
          <ExportButton />
        </div>
      </div>
      <TabsContent value="transcript" className="flex-1 overflow-hidden">
        <TranscriptPanel
          key={activeProjectId}
          editing={transcriptEditing}
          onEditingChange={setTranscriptEditing}
        />
      </TabsContent>
      <TabsContent value="summary" className="flex-1 overflow-hidden">
        <SummaryPanel
          key={activeProjectId}
          onJumpToTranscript={handleJumpToTranscript}
          editing={summaryEditing}
          onEditingChange={setSummaryEditing}
        />
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
