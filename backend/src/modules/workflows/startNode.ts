// Guarantee a workflow definition has EXACTLY ONE START node.
//
// - No START: add one (id "start", or a unique id if "start" is taken) and, if
//   there's an obvious entry node (a node nothing points to), connect it.
// - Several STARTs: keep the first, drop the others, and re-point their
//   outgoing edges to the kept START so no branch is lost.
// - Edges INTO the START node are removed (they'd loop the flow).

interface Def {
  nodes: any[];
  edges: any[];
  [k: string]: any;
}

export function ensureSingleStart<T extends Def>(def: T): T {
  const nodes: any[] = Array.isArray(def.nodes) ? [...def.nodes] : [];
  let edges: any[] = Array.isArray(def.edges) ? [...def.edges] : [];

  const starts = nodes.filter((n) => n?.nodeType === "START");

  if (starts.length === 0) {
    const ids = new Set(nodes.map((n) => String(n?.id)));
    let id = "start";
    for (let i = 2; ids.has(id); i++) id = `start_${i}`;

    // Entry candidate: first node that has no incoming edge.
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
  if (starts.length > 1) {
    const extra = new Set(starts.slice(1).map((s) => String(s.id)));
    const kept = nodes.filter((n) => !extra.has(String(n?.id)));
    edges = edges
      .filter((e) => !extra.has(String(e?.target)))
      .map((e) => (extra.has(String(e?.source)) ? { ...e, source: keep.id } : e));
    nodes.length = 0;
    nodes.push(...kept);
  }

  // No edge may target START.
  edges = edges.filter((e) => String(e?.target) !== String(keep.id));

  // De-duplicate edges that may have collapsed onto the kept START.
  const seen = new Set<string>();
  edges = edges.filter((e) => {
    const k = `${e.source}|${e.target}|${e.sourceHandle ?? ""}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  return { ...def, nodes, edges };
}
