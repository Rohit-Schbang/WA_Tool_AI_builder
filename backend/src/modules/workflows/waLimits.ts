// WhatsApp Cloud API character / count limits.
//
// These are the hard caps Meta enforces on outbound interactive and text
// messages (verified against the Cloud API docs for text, reply buttons and
// interactive lists), plus a few sensible caps of our own ("OURS") for fields
// that never reach WhatsApp directly (prompts, expressions, keywords) so a
// single runaway field can't bloat a published definition.
//
// Shared by the publish-time validator (backend) and mirrored on the frontend
// (frontend/src/lib/waLimits.ts) for live maxLength + counters. Keep the two
// files in sync.

export const WA_LIMITS = {
  // --- Plain text message body (no interactive buttons) ---
  text: 4096, // Meta: text message body

  // --- Reply (CTA) buttons change the body cap ---
  // When a Send Message carries reply buttons, Meta caps the body at 1024.
  buttonBody: 1024, // Meta: interactive reply-button body

  // --- Shared interactive chrome ---
  header: 60, // Meta: interactive header text
  footer: 60, // Meta: interactive footer text

  // --- Reply buttons ---
  buttonLabel: 20, // Meta: reply-button / CTA title
  maxButtons: 3, // Meta: max reply buttons per message

  // --- Interactive list ---
  listButton: 20, // Meta: the button that opens the list
  rowTitle: 24, // Meta: list row title
  rowDescription: 72, // Meta: list row description
  maxRows: 10, // Meta: max rows across all sections

  // --- Question (ASK_INPUT) ---
  question: 1024, // sent as a text body before waiting
  failureMessage: 1024, // wrong-type / invalid reply text

  // --- AI Reply (AI_RESPONSE) ---
  aiPrompt: 4096, // OURS: sent to the model, not WhatsApp
  aiFallback: 4096, // sent as a text message on failure

  // --- Set Variable / Transform ---
  value: 4096, // OURS: value / JS expression cap
  expression: 4096, // OURS: Transform JS expression cap

  // --- If/Else (CONDITION) + Validate ---
  compareValue: 4096, // OURS: value to compare
  regexPattern: 1024, // OURS: regex pattern cap

  // --- End ---
  endMessage: 4096, // closing text message

  // --- Start ---
  keyword: 512, // OURS: per trigger keyword

  // --- Variable name (OURS) ---
  variableName: 64,
} as const;

export type WaLimitKey = keyof typeof WA_LIMITS;
