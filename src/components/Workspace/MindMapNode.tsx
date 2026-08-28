import { memo } from "react";
import { Handle, Position } from "@xyflow/react";
import type { NodeProps } from "@xyflow/react";

interface MindMapNodeData {
  label: string;
  bgColor?: string;
  textColor?: string;
  borderColor?: string;
  fontWeight?: number;
  fontSize?: number;
  lineThrough?: boolean;
}

function MindMapNodeInner({ data }: NodeProps) {
  const {
    label,
    bgColor = "#fff",
    textColor = "#333",
    borderColor,
    fontWeight = 400,
    fontSize = 12,
    lineThrough = false,
  } = data as unknown as MindMapNodeData;

  return (
    <>
      <Handle
        type="target"
        position={Position.Left}
        id="left"
        style={{ background: "#94a3b8", width: 6, height: 6 }}
      />
      <div
        style={{
          background: bgColor,
          color: textColor,
          fontWeight,
          fontSize,
          borderRadius: 6,
          border: borderColor ? `1px solid ${borderColor}` : "none",
          padding: "6px 12px",
          maxWidth: 240,
          textDecoration: lineThrough ? "line-through" : "none",
          whiteSpace: "normal",
          wordBreak: "break-word",
          lineHeight: 1.4,
        }}
      >
        {label}
      </div>
      <Handle
        type="source"
        position={Position.Right}
        id="right"
        style={{ background: "#94a3b8", width: 6, height: 6 }}
      />
    </>
  );
}

export const MindMapNode = memo(MindMapNodeInner);
