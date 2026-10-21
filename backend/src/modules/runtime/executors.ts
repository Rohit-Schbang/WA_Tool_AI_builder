import { generateAiReply } from "./aiProvider.js";
import { evalExpression } from "./sandbox.js";
import type { NodeExecutor, ExecutorResult } from "./types.js";

// Replace {{variable}} placeholders in a string with values from context.
function interpolate(text: string, variables: Record<string, any>): string {
  return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key) => {
    return variables[key] ?? "";
  });
}

const start: NodeExecutor = async () => {
  return { action: "next" };
};

// ---------------------------------------------------------------------------
// Shared logic for CHOICE nodes (Send Message w/ CTA buttons, BUTTONS, LIST):
//   - lock on backtrack (config.lockAfterAnswer): ignore a 2nd selection
//   - store the chosen option in a variable (config.answerVariable/answerValue)
//   - wrong-reply handling (config.invalidReply): re-prompt N times, then
//     optionally route to a fallback node (else keep waiting)
// `reprompt` re-sends the node's prompt/options (same as the arrival branch).
// ---------------------------------------------------------------------------
type ChoiceOption = { id: string; label: string };

async function resolveChoice(
  node: any,
  ctx: Parameters<NodeExecutor>[1],
  options: ChoiceOption[],
  reprompt: () => Promise<void>
): Promise<ExecutorResult | { matched: ChoiceOption }> {
  const cfg = node.config ?? {};
  const lockKey = `__answered_${node.id}`;

  // Backtrack lock: already answered and locked -> gently refuse, don't branch.
  if (cfg.lockAfterAnswer && ctx.variables[lockKey]) {
    const msg = cfg.lockedMessage
      ? interpolate(String(cfg.lockedMessage), ctx.variables)
      : "You've already answered this step.";
    await ctx.messaging.sendText(ctx.userId, msg);
    return { action: "wait" };
  }

  const reply = (ctx.incomingText ?? "").trim().toLowerCase();
  const matched = options.find((o) => o.label.trim().toLowerCase() === reply || o.id === ctx.incomingText);

  if (!matched) {
    const inv = cfg.invalidReply ?? {};
    const retryKey = `__invalid_${node.id}`;
    const attempts = Number(ctx.variables[retryKey] ?? 0) + 1;
    const max = Math.max(1, Math.min(5, Number(inv.maxRetries ?? 3)));

    if (attempts >= max) {
      delete ctx.variables[retryKey];
      if (inv.goToNodeId) {
        if (inv.message) await ctx.messaging.sendText(ctx.userId, interpolate(String(inv.message), ctx.variables));
        return { action: "next", handle: "__invalid__", goToNodeId: inv.goToNodeId };
      }
      // No fallback node: keep waiting (count reset so it can prompt again).
      await ctx.messaging.sendText(ctx.userId, interpolate(String(inv.message || "Please pick one of the options."), ctx.variables));
      await reprompt();
      return { action: "wait" };
    }

    ctx.variables[retryKey] = attempts;
    await ctx.messaging.sendText(ctx.userId, interpolate(String(inv.message || "Please pick one of the options below."), ctx.variables));
    await reprompt();
    return { action: "wait" };
  }

  // Matched: clear retry, store the selection, set the lock flag.
  delete ctx.variables[`__invalid_${node.id}`];
  if (cfg.answerVariable) {
    ctx.variables[cfg.answerVariable] = cfg.answerValue === "id" ? matched.id : matched.label;
  }
  if (cfg.lockAfterAnswer) ctx.variables[lockKey] = true;
  return { matched };
}

const sendMessage: NodeExecutor = async (node, ctx) => {
  const cfg = node.config ?? {};
  const body = interpolate(cfg.text ?? "", ctx.variables);
  const footer = cfg.footer ? interpolate(cfg.footer, ctx.variables) : undefined;

  // #10 — each button is either "cta" (a reply button that branches to a node)
  // or "url" (a Visit URL button that opens a link). Default kind is "cta".
  const allButtons: { id: string; label: string; kind?: string; url?: string }[] = cfg.buttons ?? [];
  const ctaButtons = allButtons.filter((b) => (b.kind ?? "cta") === "cta");
  const urlButtons = allButtons.filter((b) => b.kind === "url" && b.url);

  // A Visit URL button -> send a cta_url message (WhatsApp allows one URL
  // button per message; we use the first). This does not branch/wait.
  if (urlButtons.length > 0) {
    const b = urlButtons[0];
    const url = interpolate(b.url ?? "", ctx.variables);
    if (ctx.messaging.sendCtaUrl) {
      await ctx.messaging.sendCtaUrl(ctx.userId, body, b.label, url, footer);
    } else {
      await ctx.messaging.sendText(ctx.userId, `${body}\n${b.label}: ${url}`);
    }
    return { action: "next" };
  }

  // CTA (reply) buttons -> send prompt + buttons, wait, branch by choice.
  if (ctaButtons.length > 0) {
    const send = async () => {
      if (ctx.messaging.sendButtons) await ctx.messaging.sendButtons(ctx.userId, body, ctaButtons);
      else await ctx.messaging.sendText(ctx.userId, body);
    };
    if (ctx.incomingText === null) { await send(); return { action: "wait" }; }
    const res = await resolveChoice(node, ctx, ctaButtons, send);
    if ("matched" in res) return { action: "next", handle: res.matched.id };
    return res;
  }

  // #12 — no buttons: header/body/footer rich message.
  const header = cfg.header?.type && cfg.header?.value
    ? { type: cfg.header.type, value: interpolate(cfg.header.value, ctx.variables) }
    : undefined;

  if ((header || footer) && ctx.messaging.sendRichMessage) {
    await ctx.messaging.sendRichMessage(ctx.userId, { header, body, footer });
  } else {
    await ctx.messaging.sendText(ctx.userId, body);
  }
  return { action: "next" };
};

// Preset validation patterns for the ASK_INPUT node's validation types.
function askInputValid(validationType: string, regex: string | undefined, value: string): boolean {
  const v = (value ?? "").trim();
  switch (validationType) {
    case "phone":
      return /^\+?[0-9][0-9\s\-()]{8,15}$/.test(v) && (v.match(/\d/g)?.length ?? 0) >= 10;
    case "email":
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
    case "url":
      return /^https?:\/\/.+/.test(v);
    case "number":
      return /^[0-9]+$/.test(v);
    case "alphanumeric":
      return /^[a-zA-Z0-9]+$/.test(v);
    case "custom":
      try { return new RegExp(regex ?? "").test(v); } catch { return true; }
    default:
      return true; // "none" or unknown -> no validation
  }
}

// Does the inbound message's type satisfy what the Question node expects?
// expectedType "text" (default) or "any" keep the original text behaviour;
// media types require a matching inbound type. "any" accepts anything.
function inboundTypeMatches(expected: string, actual: string | null | undefined): boolean {
  const want = (expected || "text").toLowerCase();
  const got = (actual || "text").toLowerCase();
  if (want === "any") return true;
  if (want === "text") {
    // A text question also accepts an interactive (button/list) reply, which is
    // effectively a text selection.
    return got === "text" || got === "interactive";
  }
  return want === got;
}

// Friendly label for the expected media type, used in the default retry prompt.
const EXPECTED_TYPE_LABEL: Record<string, string> = {
  image: "a photo/image",
  audio: "an audio message",
  video: "a video",
  document: "a document/file",
  location: "a location",
};

const askInput: NodeExecutor = async (node, ctx) => {
  const cfg = node.config ?? {};
  // If there's no incoming message, we're ARRIVING at this node:
  // send the question (+ optional footer) and wait for the user's reply.
  if (ctx.incomingText === null) {
    const question = interpolate(cfg.text ?? "", ctx.variables);
    const footer = cfg.footer ? interpolate(cfg.footer, ctx.variables) : "";
    const full = [question, footer].filter(Boolean).join("\n");
    if (full) await ctx.messaging.sendText(ctx.userId, full);
    return { action: "wait" };
  }

  // Backtrack lock: if the user already answered and the node is locked,
  // don't re-ask or overwrite — just acknowledge and move on.
  const lockKey = `__answered_${node.id}`;
  if (cfg.lockAfterAnswer && ctx.variables[lockKey]) {
    const msg = cfg.lockedMessage ? interpolate(String(cfg.lockedMessage), ctx.variables) : "You've already answered this.";
    await ctx.messaging.sendText(ctx.userId, msg);
    return { action: "next" };
  }

  const expectedType: string = (cfg.expectedType ?? "text").toLowerCase();
  const validationType = cfg.validationType ?? "none";
  const variable = cfg.variable;
  const retryKey = `__retry_${node.id}`;
  const incomingType = ctx.incomingType ?? "text";
  const media = ctx.incomingMedia ?? null;

  // Store the captured answer. For media types we store a structured object
  // (media id/caption/etc) so later nodes can download/forward it; for text we
  // store the string exactly as before.
  const storeAnswer = () => {
    if (cfg.lockAfterAnswer) ctx.variables[lockKey] = true;
    if (!variable) return;
    // Store a media object whenever the reply actually carried media (covers
    // expectedType "any" too). Plain text answers store the string as before.
    if (media && incomingType !== "text" && incomingType !== "interactive") {
      ctx.variables[variable] = { type: incomingType, ...media, text: ctx.incomingText || undefined };
    } else {
      ctx.variables[variable] = ctx.incomingText;
    }
  };

  // Build the failure/invalid prompt (shared by type- and text-validation).
  const failMsg = cfg.failureMessage
    ? interpolate(cfg.failureMessage, ctx.variables)
    : expectedType !== "text" && expectedType !== "any"
      ? `Please send ${EXPECTED_TYPE_LABEL[expectedType] ?? "the requested attachment"}.`
      : "That doesn't look valid. Please try again.";
  const limit = Math.max(1, Math.min(5, Number(cfg.retryLimit ?? 3)));

  const failOrRetry = async (): Promise<ExecutorResult> => {
    const attempts = Number(ctx.variables[retryKey] ?? 0) + 1;
    if (attempts >= limit) {
      // Retries exhausted — show the failure message once, store whatever we
      // got anyway, and continue so the flow doesn't get stuck.
      await ctx.messaging.sendText(ctx.userId, failMsg);
      storeAnswer();
      delete ctx.variables[retryKey];
      return { action: "next" };
    }
    ctx.variables[retryKey] = attempts;
    await ctx.messaging.sendText(ctx.userId, failMsg);
    return { action: "wait" };
  };

  // 1) Enforce the expected INPUT TYPE first (image/audio/document/…).
  if (!inboundTypeMatches(expectedType, incomingType)) {
    return failOrRetry();
  }

  // 2) For media/location/any answers, there's no text regex to run — accept.
  //    (storeAnswer saves a media object when the reply carries media, even for
  //    expectedType "any", so a video/photo isn't flattened to a string.)
  if (expectedType !== "text" || validationType === "none") {
    storeAnswer();
    delete ctx.variables[retryKey];
    return { action: "next" };
  }

  // 3) Text answer with a text validation — run the regex check as before.
  if (askInputValid(validationType, cfg.regex, ctx.incomingText ?? "")) {
    storeAnswer();
    delete ctx.variables[retryKey];
    return { action: "next" };
  }

  return failOrRetry();
};

// Evaluate an If/Else condition using the operator chosen in the builder.
// `expected` may reference variables ({{var}}), so it's interpolated first.
// Numeric operators coerce both sides to numbers; string operators compare
// case-insensitively as strings.
function evaluateCondition(
  operator: string,
  actual: any,
  expected: any
): boolean {
  const aStr = actual == null ? "" : String(actual);
  const eStr = expected == null ? "" : String(expected);
  const aStrLc = aStr.trim().toLowerCase();
  const eStrLc = eStr.trim().toLowerCase();
  const aNum = Number(actual);
  const eNum = Number(expected);
  const bothNumeric = !Number.isNaN(aNum) && !Number.isNaN(eNum) && aStr.trim() !== "" && eStr.trim() !== "";

  // "Empty" = missing, blank/whitespace-only, or a non-numeric NaN value.
  const isEmpty =
    actual == null ||
    aStr.trim() === "" ||
    (typeof actual === "number" && Number.isNaN(actual));

  switch (operator) {
    case "is_empty":
      return isEmpty;
    case "is_not_empty":
      return !isEmpty;
    case "not_equals":
      return aStrLc !== eStrLc;
    case "greater_than":
      return bothNumeric ? aNum > eNum : aStr > eStr;
    case "greater_than_equal":
      return bothNumeric ? aNum >= eNum : aStr >= eStr;
    case "less_than":
      return bothNumeric ? aNum < eNum : aStr < eStr;
    case "less_than_equal":
      return bothNumeric ? aNum <= eNum : aStr <= eStr;
    case "starts_with":
      return aStrLc.startsWith(eStrLc);
    case "ends_with":
      return aStrLc.endsWith(eStrLc);
    case "contains":
      return aStrLc.includes(eStrLc);
    case "equals":
    default:
      return aStrLc === eStrLc;
  }
}

const condition: NodeExecutor = async (node, ctx) => {
  // Normalize the field name: strip any {{ }} braces and surrounding
  // whitespace so it matches the plain variable key used elsewhere.
  const field = String(node.config.field ?? "").replace(/[{}]/g, "").trim();
  const operator = node.config.operator ?? "equals";
  // Allow the compared value to reference variables, e.g. {{other_var}}.
  const expected = interpolate(String(node.config.value ?? ""), ctx.variables);
  const actual = ctx.variables[field];

  const matches = evaluateCondition(operator, actual, expected);
  return { action: "next", handle: matches ? "true" : "else" };
};

const setVariable: NodeExecutor = async (node, ctx) => {
  const variable = node.config.variable;
  if (variable) {
    ctx.variables[variable] = interpolate(node.config.value ?? "", ctx.variables);
  }
  return { action: "next" };
};

// Delays up to this long are waited out in-process, then the flow continues
// on its own (the webhook has already been acknowledged, and the test chat
// gets the follow-up messages in the same response).
export const INLINE_DELAY_MAX_SECONDS = 30;
const MAX_DELAY_SECONDS = 86400;

export const waitUntilKey = (nodeId: string) => `__waitUntil_${nodeId}`;

const wait: NodeExecutor = async (node, ctx) => {
  const seconds = Math.max(0, Math.min(MAX_DELAY_SECONDS, Number(node.config.seconds) || 0));
  const key = waitUntilKey(node.id);

  // Resuming a longer delay (sweeper, or a user message after it's due).
  if (ctx.variables[key] != null) {
    if (Date.now() < Number(ctx.variables[key])) return { action: "wait" }; // not due yet: ignore the message
    delete ctx.variables[key];
    return { action: "next" };
  }

  if (seconds <= INLINE_DELAY_MAX_SECONDS) {
    if (seconds > 0) await new Promise((r) => setTimeout(r, seconds * 1000));
    return { action: "next" };
  }

  // Longer delay: pause here; fallbackSweeper resumes the flow when it's due.
  ctx.variables[key] = Date.now() + seconds * 1000;
  return { action: "wait" };
};

// End of journey: optionally send a closing message, then finish. The user can
// restart later with the trigger keyword (e.g. "Hi").
const end: NodeExecutor = async (node, ctx) => {
  const text = String(node.config?.text ?? "").trim();
  if (text) await ctx.messaging.sendText(ctx.userId, interpolate(text, ctx.variables));
  return { action: "end" };
};

const buttons: NodeExecutor = async (node, ctx) => {
  const opts: ChoiceOption[] = node.config.buttons ?? [];
  const send = async () => {
    const text = interpolate(node.config.text ?? "", ctx.variables);
    if (ctx.messaging.sendButtons) await ctx.messaging.sendButtons(ctx.userId, text, opts);
    else await ctx.messaging.sendText(ctx.userId, text);
  };
  if (ctx.incomingText === null) { await send(); return { action: "wait" }; }
  const res = await resolveChoice(node, ctx, opts, send);
  if ("matched" in res) return { action: "next", handle: res.matched.id };
  return res;
};

const list: NodeExecutor = async (node, ctx) => {
  const rows: ChoiceOption[] = node.config.rows ?? [];
  const send = async () => {
    const text = interpolate(node.config.text ?? "", ctx.variables);
    if (ctx.messaging.sendList) await ctx.messaging.sendList(ctx.userId, text, node.config.buttonText ?? "Select", rows);
    else await ctx.messaging.sendText(ctx.userId, text);
  };
  if (ctx.incomingText === null) { await send(); return { action: "wait" }; }
  const res = await resolveChoice(node, ctx, rows, send);
  if ("matched" in res) return { action: "next", handle: res.matched.id };
  return res;
};

const aiResponse: NodeExecutor = async (node, ctx) => {

  const prompt = interpolate(node.config.prompt ?? "", ctx.variables)

  let reply: string;
  try {
    reply = await generateAiReply(prompt)
  } catch (error) {
    console.error("AI RESPONSE node error: ", error)
    reply = node.config.fallbackText ?? "Sorry, I couldn't come up with a response right now.";
  }

  //  Storing the reply in the variableso the later nodes can refernce it
  const variable = node.config.variable;
  if (variable) ctx.variables[variable] = reply

  // By default, send the reply straight to the user
  if (node.config.sendReply != false) {
    await ctx.messaging.sendText(ctx.userId, reply)
  }

  return { action: "next" }

}

// ---------------------------------------------------------------------------
// #7.1 — VALIDATE: check a value/variable via JS expression or regex.
// Branches to "true" (pass) or "else" (fail).
// ---------------------------------------------------------------------------
const validateNode: NodeExecutor = async (node, ctx) => {
  const cfg = node.config ?? {};
  const mode = cfg.mode ?? "expression"; // "expression" | "regex"
  let pass = false;

  if (mode === "regex") {
    const subject = interpolate(cfg.value ?? "", ctx.variables);
    try {
      const re = new RegExp(cfg.pattern ?? "", cfg.flags ?? "");
      pass = re.test(subject);
    } catch {
      pass = false;
    }
  } else {
    // JS expression evaluated safely; reference variables via vars.xxx
    const result = evalExpression(cfg.expression ?? "false", ctx.variables);
    pass = result.ok ? Boolean(result.value) : false;
  }

  return { action: "next", handle: pass ? "true" : "else" };
};

// ---------------------------------------------------------------------------
// #7.2 — TRANSFORM: run a JS expression and assign the result to a variable.
// ---------------------------------------------------------------------------
const transformNode: NodeExecutor = async (node, ctx) => {
  const cfg = node.config ?? {};
  const result = evalExpression(cfg.expression ?? "", ctx.variables);
  if (result.ok && cfg.variable) {
    ctx.variables[cfg.variable] = result.value;
  }
  return { action: "next" };
};

// ---------------------------------------------------------------------------
// #9 — API_REQUEST: outbound HTTP with timeout, response mapping.
// Branches to "true" (success 2xx) or "else" (failure/timeout).
// ---------------------------------------------------------------------------
const apiRequestNode: NodeExecutor = async (node, ctx) => {
  const cfg = node.config ?? {};

  // Global-config-only policy: an API_REQUEST MUST reference a saved global API
  // config (base URL + shared headers) by name. Inline url/method/headers/body
  // are no longer honored — this keeps every outbound call going through a
  // reviewed, central definition. If the config (or its chosen endpoint) can't
  // be resolved, we fail down the "else" branch rather than calling a URL the
  // operator didn't vet.
  const global = ctx.apiConfigs?.[cfg.apiConfig] ?? null;
  if (!global) {
    if (cfg.statusVariable) ctx.variables[cfg.statusVariable] = "error";
    if (cfg.errorVariable) ctx.variables[cfg.errorVariable] = "No global API config selected for this request.";
    console.error(`API_REQUEST node "${node.id}" has no valid global API config (apiConfig="${cfg.apiConfig ?? ""}").`);
    return { action: "next", handle: "else" };
  }

  // The call targets a named endpoint within the global config. If the config
  // defines endpoints, one must be chosen; a config with no endpoints hits its
  // base URL directly.
  const endpoints: any[] = global.endpoints ?? [];
  const endpoint = endpoints.find((e: any) => e.id === cfg.endpointId) ?? null;
  if (endpoints.length > 0 && !endpoint) {
    if (cfg.statusVariable) ctx.variables[cfg.statusVariable] = "error";
    if (cfg.errorVariable) ctx.variables[cfg.errorVariable] = "No endpoint selected from the global API config.";
    console.error(`API_REQUEST node "${node.id}" did not select a valid endpoint from config "${cfg.apiConfig}".`);
    return { action: "next", handle: "else" };
  }

  // Method / path / body all come from the global config + endpoint only.
  const method = (endpoint?.method || "GET").toUpperCase();

  // Build URL from the global base URL + the endpoint path (interpolated).
  let url = interpolate(endpoint?.path ?? "", ctx.variables);
  if (global.baseUrl && !/^https?:\/\//i.test(url)) {
    url = global.baseUrl.replace(/\/$/, "") + "/" + url.replace(/^\//, "");
  }

  // Per-call query params stay node-level (they parameterise the call, they
  // don't define a new API). Supports {{vars}}.
  const query: Record<string, string> = {};
  for (const q of cfg.query ?? []) {
    if (q?.key) query[q.key] = interpolate(String(q.value ?? ""), ctx.variables);
  }
  const qs = new URLSearchParams(query).toString();
  if (qs) url += (url.includes("?") ? "&" : "?") + qs;

  // Headers come only from the global config's shared headers.
  const headers: Record<string, string> = {};
  for (const h of global.headers ?? []) {
    if (h?.key) headers[h.key] = interpolate(String(h.value ?? ""), ctx.variables);
  }

  // Body (for non-GET) comes from the endpoint's body template only.
  let body: string | undefined;
  const bodyTemplate = endpoint?.body;
  if (method !== "GET" && method !== "DELETE" && bodyTemplate) {
    body = interpolate(bodyTemplate, ctx.variables);
    if (!headers["Content-Type"] && !headers["content-type"]) {
      headers["Content-Type"] = "application/json";
    }
  }

  // Timeout via AbortController (#9). Default 10s, capped at 60s.
  const timeoutMs = Math.min(Math.max(Number(cfg.timeoutMs ?? 10000), 1000), 60000);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, { method, headers, body, signal: controller.signal });
    clearTimeout(timer);

    // Parse response (JSON if possible, else text).
    let data: any;
    const text = await res.text();
    try { data = JSON.parse(text); } catch { data = text; }

    // Store status + raw response in variables if requested.
    if (cfg.statusVariable) ctx.variables[cfg.statusVariable] = res.status;
    if (cfg.responseVariable) ctx.variables[cfg.responseVariable] = data;

    // Map response fields (dot-path) to variables.
    for (const m of cfg.responseMap ?? []) {
      if (m?.path && m?.variable) {
        ctx.variables[m.variable] = getByPath(data, m.path);
      }
    }

    return { action: "next", handle: res.ok ? "true" : "else" };
  } catch (err: any) {
    clearTimeout(timer);
    const isTimeout = err?.name === "AbortError";
    if (cfg.statusVariable) ctx.variables[cfg.statusVariable] = isTimeout ? "timeout" : "error";
    if (cfg.errorVariable) ctx.variables[cfg.errorVariable] = isTimeout ? "timeout" : String(err?.message ?? err);
    console.error("API_REQUEST node error:", err?.message ?? err);
    return { action: "next", handle: "else" };
  }
};

// Read a dot-path (e.g. "data.user.name" or "items.0.id") out of an object.
function getByPath(obj: any, path: string): any {
  return path.split(".").reduce((acc, key) => {
    if (acc == null) return undefined;
    return acc[key];
  }, obj);
}


// The registry: map a nodeType to its executor.
// Adding a new node type later means adding one entry here.
export const executors: Record<string, NodeExecutor> = {
  START: start,
  SEND_MESSAGE: sendMessage,
  ASK_INPUT: askInput,
  BUTTONS: buttons,
  LIST: list,
  CONDITION: condition,
  AI_RESPONSE: aiResponse,
  SET_VARIABLE: setVariable,
  VALIDATE: validateNode,
  TRANSFORM: transformNode,
  API_REQUEST: apiRequestNode,
  WAIT: wait,
  END: end,
};
