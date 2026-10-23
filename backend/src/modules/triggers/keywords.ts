// Trigger keywords — one set of rules used by saving, checking and routing, so
// a keyword that's "the same" is treated the same everywhere.
//
// A journey's trigger lives on its START node: config.keywords (string[]) and
// config.matchType ("exact" | "starts_with" | "contains"; anything else, incl.
// the old never-implemented "regex", behaves as "contains"). A START with no
// keywords triggers on ANY message — a "catch-all" journey.

export type MatchType = "exact" | "starts_with" | "contains";

// Reserved key a catch-all journey holds, so only ONE journey per WhatsApp
// number can answer "any message". Can't collide with a real keyword because
// normalizeKeyword() never produces angle brackets around "any message".
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

export interface Trigger {
  keywords: string[];       // normalised, de-duplicated
  matchType: MatchType;
  catchAll: boolean;        // no keywords -> answers any message
}

export function triggerOfStart(startConfig: any): Trigger {
  const raw: unknown[] = Array.isArray(startConfig?.keywords) ? startConfig.keywords : [];
  const keywords = [...new Set(raw.map(normalizeKeyword).filter(Boolean))];
  const mt = startConfig?.matchType;
  const matchType: MatchType = mt === "exact" || mt === "starts_with" ? mt : "contains";
  return { keywords, matchType, catchAll: keywords.length === 0 };
}

export function triggerOf(definition: any): Trigger {
  const start = (Array.isArray(definition?.nodes) ? definition.nodes : []).find((n: any) => n?.nodeType === "START");
  return triggerOfStart(start?.config);
}

// The keys a definition reserves on its phone number.
export function reservedKeys(definition: any): string[] {
  const t = triggerOf(definition);
  return t.catchAll ? [ANY_MESSAGE] : t.keywords;
}

// How well a message matches a trigger: 3 = the whole message is the keyword,
// 2 = it starts with it, 1 = it contains it. `length` breaks ties (longer,
// more specific keyword wins). null = no match. Catch-all isn't scored here.
export function matchScore(trigger: Trigger, text: string): { score: number; length: number } | null {
  if (trigger.catchAll) return null;
  const msg = normalizeKeyword(text);
  if (!msg) return null;
  let best: { score: number; length: number } | null = null;
  for (const kw of trigger.keywords) {
    let score = 0;
    if (msg === kw) score = 3;
    else if (trigger.matchType !== "exact" && msg.startsWith(kw)) score = 2;
    else if (trigger.matchType === "contains" && msg.includes(kw)) score = 1;
    if (score && (!best || score > best.score || (score === best.score && kw.length > best.length))) {
      best = { score, length: kw.length };
    }
  }
  return best;
}

// Should this START node start its journey for this message?
export function matchesStartNode(startConfig: any, text: string): boolean {
  const t = triggerOfStart(startConfig);
  return t.catchAll || matchScore(t, text) !== null;
}
