import dagre from "dagre";
import type { Node, Edge } from "reactflow";

// Approximate node size for layout spacing. Nodes vary a bit (buttons/list
// grow taller) but this is close enough for a clean tree arrangement.
const NODE_WIDTH = 240;
const NODE_HEIGHT = 110;

// The visual left→right (TB) / top→bottom (LR) order of a node's SOURCE handles.
// Layout uses this to place each branch's target on the same side as the handle
// it leaves, so edges don't cross and the under-handle labels line up:
//   - CONDITION / API_REQUEST: "true"/"success" is the LEFT handle (left: 28%),
//     "else"/"failure" is the RIGHT handle (left: 72%) — see workflow.Node.tsx.
//   - Choice nodes (BUTTONS / LIST / SEND_MESSAGE with CTA buttons): one handle
//     per option, in the order the options are listed in config.
function handleOrder(node: Node): string[] {
  const t = node.data?.nodeType;
  const cfg = node.data?.config ?? {};
  if (t === "CONDITION" || t === "API_REQUEST") return ["true", "else"];
  if (t === "BUTTONS") return (cfg.buttons ?? []).map((b: any) => String(b.id));
  if (t === "LIST") return (cfg.rows ?? []).map((r: any) => String(r.id));
  if (t === "SEND_MESSAGE") {
    return (cfg.buttons ?? [])
      .filter((b: any) => (b.kind ?? "cta") === "cta")
      .map((b: any) => String(b.id));
  }
  return [];
}

// Reorder each branching node's target nodes so they follow the handle order
// (left handle → left target, etc.). Runs AFTER dagre: dagre still decides the
// ranks, spacing and overall tree; we only correct the cross-axis order of a
// branch's own children and move each target's owned subtree with it.
//
// `axis` is the cross-axis for the layout direction: x for TB, y for LR.
// Deterministic and idempotent (sort current coords → reassign in handle order).
function enforceHandleOrder(nodes: Node[], edges: Edge[], direction: "TB" | "LR") {
  const axis: "x" | "y" = direction === "LR" ? "y" : "x";
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const valid = (e: Edge) => byId.has(e.source) && byId.has(e.target);

  const outHandles = (id: string) => edges.filter((e) => e.source === id && e.sourceHandle && valid(e));
  const parentCount = (id: string) => edges.filter((e) => e.target === id && valid(e)).length;

  // Nodes reachable ONLY through `root` (a branch's exclusive subtree), so a
  // shared/merge node — reachable without going through `root` — never moves.
  const exclusiveSubtree = (root: string, forbidden: Set<string>): string[] => {
    const owned: string[] = [];
    const seen = new Set<string>([root]);
    const queue = [root];
    while (queue.length) {
      const id = queue.shift()!;
      if (id !== root) owned.push(id);
      for (const e of edges.filter((x) => x.source === id && valid(x))) {
        const next = e.target;
        if (seen.has(next) || forbidden.has(next)) continue;
        // Only follow a child we solely own (single incoming edge); a merge
        // point (2+ parents) is left where dagre placed it.
        if (parentCount(next) > 1) continue;
        seen.add(next);
        queue.push(next);
      }
    }
    return owned;
  };

  const shift = (ids: string[], delta: number) => {
    if (!delta) return;
    for (const id of ids) {
      const n = byId.get(id);
      if (n) n.position = { ...n.position, [axis]: (n.position as any)[axis] + delta };
    }
  };

  for (const s of nodes) {
    const order = handleOrder(s);
    if (order.length < 2) continue;

    // The branch targets, in handle order; keep only sole-parent targets so we
    // never drag a shared/merge node across the canvas.
    const targets = order
      .map((h) => outHandles(s.id).find((e) => e.sourceHandle === h)?.target)
      .filter((t): t is string => !!t && parentCount(t) === 1);
    // De-dupe (two handles pointing at the same node can't be reordered).
    const uniqueTargets = targets.filter((t, i) => targets.indexOf(t) === i);
    if (uniqueTargets.length < 2) continue;

    // Current cross-axis slots, ascending; reassign them in handle order.
    const slots = uniqueTargets
      .map((t) => (byId.get(t)!.position as any)[axis] as number)
      .sort((a, b) => a - b);

    const forbidden = new Set(uniqueTargets); // branches don't absorb each other
    uniqueTargets.forEach((t, i) => {
      const node = byId.get(t)!;
      const delta = slots[i] - (node.position as any)[axis];
      if (delta) shift([t, ...exclusiveSubtree(t, forbidden)], delta);
    });
  }
}

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

  const positioned = nodes.map((n, i) => {
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

  // Make branch targets follow the handle order (left handle → left target) so
  // "true"/"else" (and option) edges don't cross and read on the right side.
  enforceHandleOrder(positioned, edges, direction);

  return positioned;
}
