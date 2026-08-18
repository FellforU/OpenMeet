import { useMemo, useEffect } from "react";
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
import { useTranscriptionStore } from "../../stores/transcriptionStore";
import { summaryToNodes } from "./mindmapUtils";
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

  if (!summary) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        {t("mindmap.empty")}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
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
