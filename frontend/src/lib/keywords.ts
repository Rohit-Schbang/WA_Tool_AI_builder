// Trigger keyword rules — mirror of backend/src/modules/triggers/keywords.ts.
// "Hi!", " hi " and "HI" are the same keyword. Keep the two files in sync.

export const ANY_MESSAGE = "<any message>";

export function normalizeKeyword(value: unknown): string {
  return String(value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.!?,;:]+$/u, "")
    .trim();
}

// A clash returned by the backend: another journey on the same phone number
// already holds this keyword (or already answers "any message").
export interface KeywordConflict {
  keyword: string;
  catchAll: boolean;
  chatbotId: string;
  name: string;
  isActive: boolean;
  isLive: boolean;
}
