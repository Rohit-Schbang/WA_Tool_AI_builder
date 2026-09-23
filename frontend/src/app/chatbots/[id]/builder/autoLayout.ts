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

  for (const n of nodes) {
    g.setNode(n.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  }
  for (const e of edges) {
    g.setEdge(e.source, e.target);
  }

  dagre.layout(g);

  return nodes.map((n) => {
    const pos = g.node(n.id);
    if (!pos) return n;
    // dagre gives center coords; React Flow wants top-left.
    return {
      ...n,
      position: { x: pos.x - NODE_WIDTH / 2, y: pos.y - NODE_HEIGHT / 2 },
    };
  });
}
