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

/** Convert a Summary into React Flow nodes and edges with tree layout. */
export function summaryToNodes(summary: Summary): LayoutResult {
  const nodes: Node[] = [];
  const edges: Edge[] = [];

  // Root node (topic)
  const rootId = "root";
  nodes.push({
    id: rootId,
    type: "default",
    position: { x: 0, y: 0 },
    data: { label: summary.topic },
    style: {
      background: "#4f46e5",
      color: "#fff",
      fontWeight: 600,
      borderRadius: 8,
      border: "none",
      fontSize: 14,
      padding: "8px 16px",
      minWidth: NODE_WIDTH,
    },
  });

  // Conclusions branch
  if (summary.conclusions.length > 0) {
    const branchId = "conclusions";
    nodes.push({
      id: branchId,
      type: "default",
      position: { x: 0, y: 0 },
      data: { label: "结论" },
      style: {
        background: "#059669",
        color: "#fff",
        fontWeight: 500,
        borderRadius: 6,
        border: "none",
        fontSize: 13,
        padding: "6px 12px",
        minWidth: 120,
      },
    });
    edges.push({ id: `e-root-${branchId}`, source: rootId, target: branchId });

    summary.conclusions.forEach((c, i) => {
      const nodeId = `conclusion-${i}`;
      nodes.push({
        id: nodeId,
        type: "default",
        position: { x: 0, y: 0 },
        data: { label: c },
        style: {
          background: "#ecfdf5",
          color: "#065f46",
          borderRadius: 6,
          border: "1px solid #a7f3d0",
          fontSize: 12,
          padding: "6px 10px",
          maxWidth: 220,
        },
      });
      edges.push({ id: `e-${branchId}-${nodeId}`, source: branchId, target: nodeId });
    });
  }

  // Action items branch
  if (summary.actionItems.length > 0) {
    const branchId = "actions";
    nodes.push({
      id: branchId,
      type: "default",
      position: { x: 0, y: 0 },
      data: { label: "待办事项" },
      style: {
        background: "#d97706",
        color: "#fff",
        fontWeight: 500,
        borderRadius: 6,
        border: "none",
        fontSize: 13,
        padding: "6px 12px",
        minWidth: 120,
      },
    });
    edges.push({ id: `e-root-${branchId}`, source: rootId, target: branchId });

    summary.actionItems.forEach((item, i) => {
      const nodeId = `action-${i}`;
      const label = `${item.assignee}: ${item.task}${item.deadline ? ` (${item.deadline})` : ""}`;
      nodes.push({
        id: nodeId,
        type: "default",
        position: { x: 0, y: 0 },
        data: { label },
        style: {
          background: item.done ? "#fef3c7" : "#fffbeb",
          color: "#92400e",
          borderRadius: 6,
          border: `1px solid ${item.done ? "#fbbf24" : "#fde68a"}`,
          fontSize: 12,
          padding: "6px 10px",
          maxWidth: 220,
          textDecoration: item.done ? "line-through" : "none",
        },
      });
      edges.push({ id: `e-${branchId}-${nodeId}`, source: branchId, target: nodeId });
    });
  }

  // Discussion branch
  if (summary.discussion.length > 0) {
    const branchId = "discussion";
    nodes.push({
      id: branchId,
      type: "default",
      position: { x: 0, y: 0 },
      data: { label: "讨论要点" },
      style: {
        background: "#7c3aed",
        color: "#fff",
        fontWeight: 500,
        borderRadius: 6,
        border: "none",
        fontSize: 13,
        padding: "6px 12px",
        minWidth: 120,
      },
    });
    edges.push({ id: `e-root-${branchId}`, source: rootId, target: branchId });

    summary.discussion.forEach((d, i) => {
      const nodeId = `disc-${i}`;
      nodes.push({
        id: nodeId,
        type: "default",
        position: { x: 0, y: 0 },
        data: { label: `${d.topic}: ${d.summary}` },
        style: {
          background: "#f5f3ff",
          color: "#5b21b6",
          borderRadius: 6,
          border: "1px solid #ddd6fe",
          fontSize: 12,
          padding: "6px 10px",
          maxWidth: 220,
        },
      });
      edges.push({ id: `e-${branchId}-${nodeId}`, source: branchId, target: nodeId });
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

  // Position nodes recursively
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));

  function positionNode(nodeId: string, x: number, yStart: number): void {
    const node = nodeMap.get(nodeId);
    if (!node) return;

    const children = childrenMap.get(nodeId) || [];
    const subtreeH = getSubtreeHeight(nodeId);

    // Center node vertically in its subtree
    if (children.length === 0) {
      node.position = { x, y: yStart };
    } else {
      // Position children
      let childY = yStart;
      for (const childId of children) {
        const childH = getSubtreeHeight(childId);
        positionNode(childId, x + NODE_WIDTH + HORIZONTAL_GAP, childY);
        childY += childH + VERTICAL_GAP;
      }
      // Center parent relative to children
      const firstChild = nodeMap.get(children[0]);
      const lastChild = nodeMap.get(children[children.length - 1]);
      if (firstChild && lastChild) {
        node.position = {
          x,
          y: (firstChild.position.y + lastChild.position.y) / 2,
        };
      } else {
        node.position = { x, y: yStart + subtreeH / 2 - NODE_HEIGHT / 2 };
      }
    }
  }

  positionNode("root", 0, 0);

  return { nodes: Array.from(nodeMap.values()), edges };
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
