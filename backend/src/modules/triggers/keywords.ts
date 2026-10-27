// Trigger keywords: one set of rules for saving, checking and activating, so a
// keyword that's "the same" is treated the same everywhere.
//
// A journey's trigger lives on its START node: config.keywords (string[]).
// A START with no keywords triggers on ANY message: a "catch-all" journey.

// Reserved key a catch-all journey holds, so only ONE journey in the workspace
// can answer "any message". normalizeKeyword() never produces this value.
export const ANY_MESSAGE = "<any message>";

// Same keyword regardless of case, width (NFKC), extra spaces or trailing
// punctuation: "Hi!", "  hi ", "HI" -> "hi".
export function normalizeKeyword(value: unknown): string {
  return String(value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.!?,;:]+$/u, "")
    .trim();
}

// The keys a workflow definition reserves: its normalised keywords, or
// ANY_MESSAGE when it has none. A definition without a START reserves nothing.
export function reservedKeys(definition: any): string[] {
  const nodes: any[] = Array.isArray(definition?.nodes) ? definition.nodes : [];
  const start = nodes.find((n) => n?.nodeType === "START");
  if (!start) return [];
  const raw: unknown[] = Array.isArray(start.config?.keywords) ? start.config.keywords : [];
  const keys = [...new Set(raw.map(normalizeKeyword).filter(Boolean))];
  return keys.length ? keys : [ANY_MESSAGE];
}

export interface KeywordConflict {
  keyword: string;   // normalised key (ANY_MESSAGE for a catch-all)
  catchAll: boolean;
  chatbotId: string; // the OTHER journey that already holds it
  name: string;
  isActive: boolean;
  isLive: boolean;   // has a published version
}

export interface HolderJourney {
  chatbotId: string;
  name: string;
  isActive: boolean;
  isLive: boolean;
  keys: Set<string>;
}

// Which of `keys` are already held by one of `others`.
export function findConflicts(keys: Iterable<string>, others: HolderJourney[]): KeywordConflict[] {
  const out: KeywordConflict[] = [];
  for (const k of keys) {
    for (const o of others) {
      if (o.keys.has(k)) {
        out.push({ keyword: k, catchAll: k === ANY_MESSAGE, chatbotId: o.chatbotId, name: o.name, isActive: o.isActive, isLive: o.isLive });
      }
    }
  }
  return out;
}

export function describeConflicts(conflicts: KeywordConflict[]): string {
  const parts = conflicts.map((c) =>
    `${c.catchAll ? "\"any message\" (no keywords)" : `"${c.keyword}"`} is already used by "${c.name}" (${c.isActive ? "Active" : "Inactive"})`
  );
  return `A journey with this trigger keyword already exists: ${parts.join("; ")}. Choose a different keyword or manage the existing journey first.`;
}
