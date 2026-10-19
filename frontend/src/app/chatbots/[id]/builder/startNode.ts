// Client mirror of backend/src/modules/workflows/startNode.ts.
// Guarantees a definition has EXACTLY ONE START node before it hits the canvas:
//  - none   -> add one above the flow and connect it to the entry node
//  - several -> keep the first, re-point the others' outgoing edges to it
//  - edges INTO start are dropped (they'd loop the flow)

export function ensureSingleStart<T extends { nodes?: any[]; edges?: any[] }>(def: T): T {
  const nodes: any[] = Array.isArray(def?.nodes) ? [...def.nodes] : [];
  let edges: any[] = Array.isArray(def?.edges) ? [...def.edges] : [];
  const starts = nodes.filter((n) => n?.nodeType === "START");

  if (starts.length === 0) {
    const ids = new Set(nodes.map((n) => String(n?.id)));
    let id = "start";
    for (let i = 2; ids.has(id); i++) id = `start_${i}`;
    const targeted = new Set(edges.map((e) => String(e?.target)));
    const entry = nodes.find((n) => !targeted.has(String(n?.id)));
    const first = nodes[0];
    nodes.unshift({
      id,
      nodeType: "START",
      seq: 0,
      position: { x: first?.position?.x ?? 300, y: (first?.position?.y ?? 180) - 140 },
      config: { name: "Start" },
    });
    if (entry) edges.push({ id: `e_${id}_${entry.id}`, source: id, target: entry.id, sourceHandle: null });
    return { ...def, nodes, edges };
  }

  const keep = starts[0];
  let outNodes = nodes;
  if (starts.length > 1) {
    const extra = new Set(starts.slice(1).map((s) => String(s.id)));
    outNodes = nodes.filter((n) => !extra.has(String(n?.id)));
    edges = edges
      .filter((e) => !extra.has(String(e?.target)))
      .map((e) => (extra.has(String(e?.source)) ? { ...e, source: keep.id } : e));
  }
  edges = edges.filter((e) => String(e?.target) !== String(keep.id));
  const seen = new Set<string>();
  edges = edges.filter((e) => {
    const k = `${e.source}|${e.target}|${e.sourceHandle ?? ""}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return { ...def, nodes: outNodes, edges };
}
