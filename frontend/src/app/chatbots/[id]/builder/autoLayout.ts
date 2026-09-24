import dagre from "dagre";
import type { Node, Edge } from "reactflow";

// Approximate node size for layout spacing. Nodes vary a bit (buttons/list
// grow taller) but this is close enough for a clean tree arrangement.
const NODE_WIDTH = 240;
const NODE_HEIGHT = 110;

// Arrange nodes into a tidy tree using dagre.
//   direction "TB" = top-to-bottom (vertical), "LR" = left-to-right (horizontal).
export function layoutGraph(nodes: Node[], edges: Edge[], direction: "TB" | "LR"): Node[] {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({
    rankdir: direction,
    nodesep: 60,   // gap between sibling nodes
    ranksep: 80,   // gap between levels
    marginx: 20,
    marginy: 20,
  });

  const nodeIds = new Set(nodes.map((n) => n.id));
  for (const n of nodes) {
    g.setNode(n.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  }
  for (const e of edges) {
    // Skip dangling edges (endpoint node was deleted). Feeding dagre an edge
    // that references a missing node corrupts the layout and yields NaN
    // positions, which then crash React Flow's SVG background.
    if (nodeIds.has(e.source) && nodeIds.has(e.target)) {
      g.setEdge(e.source, e.target);
    }
  }

  dagre.layout(g);

  return nodes.map((n, i) => {
    const pos = g.node(n.id);
    // Fall back to the node's current position (or a safe grid slot) whenever
    // dagre couldn't produce finite coordinates, so we never emit NaN.
    const cx = pos && Number.isFinite(pos.x) ? pos.x : undefined;
    const cy = pos && Number.isFinite(pos.y) ? pos.y : undefined;
    if (cx === undefined || cy === undefined) {
      const fallbackX = Number.isFinite(n.position?.x) ? n.position.x : 200;
      const fallbackY = Number.isFinite(n.position?.y) ? n.position.y : 40 + i * 140;
      return { ...n, position: { x: fallbackX, y: fallbackY } };
    }
    // dagre gives center coords; React Flow wants top-left.
    return {
      ...n,
      position: { x: cx - NODE_WIDTH / 2, y: cy - NODE_HEIGHT / 2 },
    };
  });
}
