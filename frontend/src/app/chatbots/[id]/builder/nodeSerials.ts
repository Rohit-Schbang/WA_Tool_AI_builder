// Per-type node numbering: "Send Message 1, Send Message 2, API Request 1…"
// instead of one shared counter across all node types. The number lives in
// node.seq; START is always 0.

// Names a node may carry from older versions of the builder, per type, so an
// auto-generated "Message 3" / "Send Message 3" can be renumbered safely.
const NAME_ALIASES: Record<string, string[]> = {
  SEND_MESSAGE: ["Send Message", "Message"],
};

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// True when `name` is just the default "<Label> <n>" (not a user-chosen name).
export function isDefaultName(name: string | undefined, nodeType: string, labels: Record<string, string>): boolean {
  const n = (name ?? "").trim();
  if (!n) return true;
  const options = [labels[nodeType] ?? nodeType, ...(NAME_ALIASES[nodeType] ?? [])];
  return options.some((l) => new RegExp(`^${escapeRe(l)}\\s+\\d+$`, "i").test(n));
}

// Next free number for a new node of `nodeType`.
export function nextSerial(nodes: { data?: any }[], nodeType: string): number {
  return nodes.reduce((m, n) => (n.data?.nodeType === nodeType ? Math.max(m, Number(n.data?.seq) || 0) : m), 0) + 1;
}

// Renumber a definition's nodes 1..n within each type, keeping their current
// relative order (by old seq, then array order). Default names are updated to
// match; names the user typed are left alone.
export function renumberByType<T extends { nodeType: string; seq?: number; config?: any }>(
  nodes: T[],
  labels: Record<string, string>
): T[] {
  const order = nodes
    .map((n, i) => ({ n, i }))
    .sort((a, b) => (Number(a.n.seq) || 0) - (Number(b.n.seq) || 0) || a.i - b.i);
  const counter: Record<string, number> = {};
  const seqOf = new Map<T, number>();
  for (const { n } of order) {
    if (n.nodeType === "START") { seqOf.set(n, 0); continue; }
    counter[n.nodeType] = (counter[n.nodeType] ?? 0) + 1;
    seqOf.set(n, counter[n.nodeType]);
  }
  return nodes.map((n) => {
    const seq = seqOf.get(n) ?? 0;
    const cfg = n.config ?? {};
    const rename = n.nodeType !== "START" && isDefaultName(cfg.name, n.nodeType, labels);
    return {
      ...n,
      seq,
      config: rename ? { ...cfg, name: `${labels[n.nodeType] ?? n.nodeType} ${seq}` } : cfg,
    };
  });
}
