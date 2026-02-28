import { useMemo, useCallback, useEffect } from "react";
import { useTranslation } from "react-i18next";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Download } from "lucide-react";
import { toast } from "sonner";
import { Button } from "../ui/button";
import { useTranscriptionStore } from "../../stores/transcriptionStore";
import { summaryToNodes, summaryToXMind } from "./mindmapUtils";
import { saveXMindViaDialog } from "./ExportButton";
import { MindMapNode } from "./MindMapNode";

const nodeTypes = { mindmapNode: MindMapNode };

export function MindMapPanel() {
  const { t } = useTranslation("workspace");
  const summary = useTranscriptionStore((s) => s.summary);

  const { computedNodes, computedEdges } = useMemo(() => {
    if (!summary) return { computedNodes: [], computedEdges: [] };
    const { nodes, edges } = summaryToNodes(summary);
    return { computedNodes: nodes, computedEdges: edges };
  }, [summary]);

  const [nodes, setNodes, onNodesChange] = useNodesState(computedNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(computedEdges);

  useEffect(() => {
    setNodes(computedNodes);
  }, [computedNodes, setNodes]);

  useEffect(() => {
    setEdges(computedEdges);
  }, [computedEdges, setEdges]);

  const handleExportXMind = useCallback(async () => {
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
  }, [summary, t]);

  if (!summary) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        {t("mindmap.empty")}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-end px-4 py-2">
        <Button variant="outline" size="sm" onClick={handleExportXMind}>
          <Download className="mr-1.5 h-4 w-4" />
          {t("mindmap.exportXmind")}
        </Button>
      </div>
      <div className="flex-1">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          nodeTypes={nodeTypes}
          fitView
          fitViewOptions={{ padding: 0.3 }}
          proOptions={{ hideAttribution: true }}
        >
          <Background />
          <Controls />
          <MiniMap />
        </ReactFlow>
      </div>
    </div>
  );
}
