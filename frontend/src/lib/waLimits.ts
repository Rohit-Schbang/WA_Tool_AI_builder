// WhatsApp Cloud API character / count limits — frontend mirror.
//
// Keep in sync with backend/src/modules/workflows/waLimits.ts. Used for live
// `maxLength` on inputs and the small "123 / N" counters in the builder. The
// backend validator enforces the same caps at publish time.

export const WA_LIMITS = {
  // Plain text message body (no interactive buttons).
  text: 4096,
  // Reply buttons shrink the allowed body to 1024.
  buttonBody: 1024,
  // Shared interactive chrome.
  header: 60,
  footer: 60,
  // Reply buttons.
  buttonLabel: 20,
  maxButtons: 3,
  // Interactive list.
  listButton: 20,
  rowTitle: 24,
  rowDescription: 72,
  maxRows: 10,
  // Question (ASK_INPUT).
  question: 1024,
  failureMessage: 1024,
  // AI Reply (AI_RESPONSE).
  aiPrompt: 4096,
  aiFallback: 4096,
  // Set Variable / Transform.
  value: 4096,
  expression: 4096,
  // If/Else (CONDITION) + Validate.
  compareValue: 4096,
  regexPattern: 1024,
  // End.
  endMessage: 4096,
  // Start.
  keyword: 512,
  // Variable name.
  variableName: 64,
} as const;

export type WaLimitKey = keyof typeof WA_LIMITS;
