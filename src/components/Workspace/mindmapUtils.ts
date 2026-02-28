import type { Node, Edge } from "@xyflow/react";
import type { Summary } from "../../types";
import { RootTopic, Topic, Workbook } from "xmind-generator";

// Layout constants
const NODE_WIDTH = 180;
const NODE_HEIGHT = 40;
const HORIZONTAL_GAP = 60;
const VERTICAL_GAP = 16;

interface LayoutResult {
  nodes: Node[];
  edges: Edge[];
}

function makeEdge(source: string, target: string): Edge {
  return {
    id: `e-${source}-${target}`,
    source,
    target,
    sourceHandle: "right",
    targetHandle: "left",
    type: "smoothstep",
    style: { strokeWidth: 2, stroke: "#94a3b8" },
  };
}

/** Convert a Summary into React Flow nodes and edges with tree layout. */
export function summaryToNodes(summary: Summary): LayoutResult {
  const nodes: Node[] = [];
  const edges: Edge[] = [];

  // Root node (topic)
  const rootId = "root";
  nodes.push({
    id: rootId,
    type: "mindmapNode",
    position: { x: 0, y: 0 },
    data: {
      label: summary.topic,
      bgColor: "#4f46e5",
      textColor: "#fff",
      fontWeight: 600,
      fontSize: 14,
    },
  });

  // Conclusions branch
  if (summary.conclusions.length > 0) {
    const branchId = "conclusions";
    nodes.push({
      id: branchId,
      type: "mindmapNode",
      position: { x: 0, y: 0 },
      data: {
        label: "结论",
        bgColor: "#059669",
        textColor: "#fff",
        fontWeight: 500,
        fontSize: 13,
      },
    });
    edges.push(makeEdge(rootId, branchId));

    summary.conclusions.forEach((c, i) => {
      const nodeId = `conclusion-${i}`;
      nodes.push({
        id: nodeId,
        type: "mindmapNode",
        position: { x: 0, y: 0 },
        data: {
          label: c,
          bgColor: "#ecfdf5",
          textColor: "#065f46",
          borderColor: "#a7f3d0",
          fontSize: 12,
        },
      });
      edges.push(makeEdge(branchId, nodeId));
    });
  }

  // Action items branch
  if (summary.actionItems.length > 0) {
    const branchId = "actions";
    nodes.push({
      id: branchId,
      type: "mindmapNode",
      position: { x: 0, y: 0 },
      data: {
        label: "待办事项",
        bgColor: "#d97706",
        textColor: "#fff",
        fontWeight: 500,
        fontSize: 13,
      },
    });
    edges.push(makeEdge(rootId, branchId));

    summary.actionItems.forEach((item, i) => {
      const nodeId = `action-${i}`;
      const label = `${item.assignee}: ${item.task}${item.deadline ? ` (${item.deadline})` : ""}`;
      nodes.push({
        id: nodeId,
        type: "mindmapNode",
        position: { x: 0, y: 0 },
        data: {
          label,
          bgColor: item.done ? "#fef3c7" : "#fffbeb",
          textColor: "#92400e",
          borderColor: item.done ? "#fbbf24" : "#fde68a",
          fontSize: 12,
          lineThrough: item.done,
        },
      });
      edges.push(makeEdge(branchId, nodeId));
    });
  }

  // Discussion branch
  if (summary.discussion.length > 0) {
    const branchId = "discussion";
    nodes.push({
      id: branchId,
      type: "mindmapNode",
      position: { x: 0, y: 0 },
      data: {
        label: "讨论要点",
        bgColor: "#7c3aed",
        textColor: "#fff",
        fontWeight: 500,
        fontSize: 13,
      },
    });
    edges.push(makeEdge(rootId, branchId));

    summary.discussion.forEach((d, i) => {
      const nodeId = `disc-${i}`;
      nodes.push({
        id: nodeId,
        type: "mindmapNode",
        position: { x: 0, y: 0 },
        data: {
          label: `${d.topic}: ${d.summary}`,
          bgColor: "#f5f3ff",
          textColor: "#5b21b6",
          borderColor: "#ddd6fe",
          fontSize: 12,
        },
      });
      edges.push(makeEdge(branchId, nodeId));
    });
  }

  // Apply tree layout
  return applyTreeLayout(nodes, edges);
}

/** Simple tree layout: root on the left, branches to the right, leaves further right. */
function applyTreeLayout(nodes: Node[], edges: Edge[]): LayoutResult {
  // Build adjacency from edges
  const childrenMap = new Map<string, string[]>();
  for (const edge of edges) {
    const list = childrenMap.get(edge.source) || [];
    list.push(edge.target);
    childrenMap.set(edge.source, list);
  }

  // Calculate subtree heights (memoized)
  const heightCache = new Map<string, number>();
  function getSubtreeHeight(nodeId: string): number {
    const cached = heightCache.get(nodeId);
    if (cached !== undefined) return cached;
    const children = childrenMap.get(nodeId) || [];
    if (children.length === 0) {
      heightCache.set(nodeId, NODE_HEIGHT);
      return NODE_HEIGHT;
    }
    const childrenHeight = children.reduce(
      (sum, childId) => sum + getSubtreeHeight(childId) + VERTICAL_GAP,
      -VERTICAL_GAP,
    );
    const height = Math.max(NODE_HEIGHT, childrenHeight);
    heightCache.set(nodeId, height);
    return height;
  }

  // Position nodes recursively, collecting positions immutably
  const positions = new Map<string, { x: number; y: number }>();

  function positionNode(nodeId: string, x: number, yStart: number): void {
    const children = childrenMap.get(nodeId) || [];

    if (children.length === 0) {
      positions.set(nodeId, { x, y: yStart });
    } else {
      let childY = yStart;
      for (const childId of children) {
        const childH = getSubtreeHeight(childId);
        positionNode(childId, x + NODE_WIDTH + HORIZONTAL_GAP, childY);
        childY += childH + VERTICAL_GAP;
      }
      const firstPos = positions.get(children[0]);
      const lastPos = positions.get(children[children.length - 1]);
      if (firstPos && lastPos) {
        positions.set(nodeId, {
          x,
          y: (firstPos.y + lastPos.y) / 2,
        });
      } else {
        const subtreeH = getSubtreeHeight(nodeId);
        positions.set(nodeId, { x, y: yStart + subtreeH / 2 - NODE_HEIGHT / 2 });
      }
    }
  }

  positionNode("root", 0, 0);

  const positionedNodes = nodes.map((n) => ({
    ...n,
    position: positions.get(n.id) || n.position,
  }));

  return { nodes: positionedNodes, edges };
}

/** Convert a Summary to an XMind archive (as Uint8Array). */
export async function summaryToXMind(summary: Summary): Promise<Uint8Array> {
  const root = RootTopic(summary.topic);
  const branchTopics = [];

  // Conclusions
  if (summary.conclusions.length > 0) {
    const conclusionChildren = summary.conclusions.map((c) => Topic(c));
    branchTopics.push(Topic("结论").children(conclusionChildren));
  }

  // Action items
  if (summary.actionItems.length > 0) {
    const actionChildren = summary.actionItems.map((item) => {
      const label = `${item.assignee}: ${item.task}${item.deadline ? ` (${item.deadline})` : ""}`;
      return Topic(label);
    });
    branchTopics.push(Topic("待办事项").children(actionChildren));
  }

  // Discussion
  if (summary.discussion.length > 0) {
    const discussionChildren = summary.discussion.map((d) =>
      Topic(d.topic).children([Topic(d.summary)]),
    );
    branchTopics.push(Topic("讨论要点").children(discussionChildren));
  }

  root.children(branchTopics);

  const workbook = Workbook(root);
  const buffer = await workbook.archive();
  return new Uint8Array(buffer);
}
