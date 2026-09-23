import { generateAiReply } from "./aiProvider.js";
import { evalExpression } from "./sandbox.js";
import type { NodeExecutor } from "./types.js";

// Replace {{variable}} placeholders in a string with values from context.
function interpolate(text: string, variables: Record<string, any>): string {
  return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key) => {
    return variables[key] ?? "";
  });
}

const start: NodeExecutor = async () => {
  return { action: "next" };
};

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
    if (ctx.incomingText === null) {
      if (ctx.messaging.sendButtons) {
        await ctx.messaging.sendButtons(ctx.userId, body, ctaButtons);
      } else {
        await ctx.messaging.sendText(ctx.userId, body);
      }
      return { action: "wait" };
    }
    const reply = ctx.incomingText.trim().toLowerCase();
    const chosen = ctaButtons.find(
      (o) => o.label.trim().toLowerCase() === reply || o.id === ctx.incomingText
    );
    if (!chosen) return { action: "wait" }; // no match — re-wait
    return { action: "next", handle: chosen.id };
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

const askInput: NodeExecutor = async (node, ctx) => {
  // If there's no incoming message, we're ARRIVING at this node:
  // send the question and wait for the user's reply.
  if (ctx.incomingText === null) {
    const question = interpolate(node.config.text ?? "", ctx.variables);
    if (question) await ctx.messaging.sendText(ctx.userId, question);
    return { action: "wait" };
  }

  // Otherwise the user just replied: capture their answer, then move on.
  const variable = node.config.variable;
  if (variable) {
    ctx.variables[variable] = ctx.incomingText;
  }
  return { action: "next" };
};

const condition: NodeExecutor = async (node, ctx) => {
  const field = node.config.field;
  const expected = node.config.value;
  const actual = ctx.variables[field];

  // Compare as strings for a simple, predictable equality check.
  const matches = String(actual) === String(expected);
  return { action: "next", handle: matches ? "true" : "else" };
};

const setVariable: NodeExecutor = async (node, ctx) => {
  const variable = node.config.variable;
  if (variable) {
    ctx.variables[variable] = interpolate(node.config.value ?? "", ctx.variables);
  }
  return { action: "next" };
};

const wait: NodeExecutor = async () => {
  // For the MVP, WAIT simply pauses execution until the next message.
  return { action: "wait" };
};

const end: NodeExecutor = async () => {
  return { action: "end" };
};

const buttons: NodeExecutor = async (node, ctx) => {
  // Arriving: send the prompt with buttons, then wait.
  if (ctx.incomingText === null) {
    const text = interpolate(node.config.text ?? "", ctx.variables);
    const opts = node.config.buttons ?? [];
    // For the console/test adapter we just send text + options as a hint.
    // (The WhatsApp adapter will render real buttons — added separately.)
    if (ctx.messaging.sendButtons) {
      await ctx.messaging.sendButtons(ctx.userId, text, opts);
    } else {
      await ctx.messaging.sendText(ctx.userId, text);
    }
    return { action: "wait" };
  }

  // Resuming: match the user's reply to a button (by label or id).
  const opts: { id: string; label: string }[] = node.config.buttons ?? [];
  const reply = ctx.incomingText.trim().toLowerCase();
  const chosen = opts.find(
    (o) => o.label.trim().toLowerCase() === reply || o.id === ctx.incomingText
  );
  if (!chosen) {
    // No match — re-ask by waiting again.
    return { action: "wait" };
  }
  return { action: "next", handle: chosen.id };
};

const list: NodeExecutor = async (node, ctx) => {
  if (ctx.incomingText === null) {
    const text = interpolate(node.config.text ?? "", ctx.variables);
    const rows = node.config.rows ?? [];
    if (ctx.messaging.sendList) {
      await ctx.messaging.sendList(ctx.userId, text, node.config.buttonText ?? "Select", rows);
    } else {
      await ctx.messaging.sendText(ctx.userId, text);
    }
    return { action: "wait" };
  }

  const rows: { id: string; label: string }[] = node.config.rows ?? [];
  const reply = ctx.incomingText.trim().toLowerCase();
  const chosen = rows.find(
    (r) => r.label.trim().toLowerCase() === reply || r.id === ctx.incomingText
  );
  if (!chosen) return { action: "wait" };
  return { action: "next", handle: chosen.id };
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
// #5 — INPUT_TYPE: collect typed user input with validation.
// ---------------------------------------------------------------------------
function validateInput(inputType: string, value: string): boolean {
  const v = (value ?? "").trim();
  switch (inputType) {
    case "number":
      return v !== "" && !isNaN(Number(v));
    case "email":
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
    case "phone":
      // digits, spaces, +, -, parentheses; at least 7 digits
      return /^[+\d][\d\s\-()]{6,}$/.test(v) && (v.match(/\d/g)?.length ?? 0) >= 7;
    case "image":
    case "video":
    case "document":
      // In the console/test path the user pastes a URL; accept a URL-ish value.
      return /^https?:\/\/\S+/.test(v) || v.length > 0;
    case "location":
      // "lat,lng"
      return /^-?\d+(\.\d+)?\s*,\s*-?\d+(\.\d+)?$/.test(v);
    case "text":
    default:
      return v.length > 0;
  }
}

const inputTypeNode: NodeExecutor = async (node, ctx) => {
  const cfg = node.config ?? {};
  // Arriving: send the prompt, then wait for the user's input.
  if (ctx.incomingText === null) {
    const prompt = interpolate(cfg.text ?? "", ctx.variables);
    if (prompt) await ctx.messaging.sendText(ctx.userId, prompt);
    return { action: "wait" };
  }

  // Resuming: validate the input against the configured type.
  const inputType = cfg.inputType ?? "text";
  const value = ctx.incomingText;
  if (!validateInput(inputType, value)) {
    const invalidMsg = cfg.invalidMessage
      ? interpolate(cfg.invalidMessage, ctx.variables)
      : `That doesn't look like a valid ${inputType}. Please try again.`;
    await ctx.messaging.sendText(ctx.userId, invalidMsg);
    return { action: "wait" }; // re-prompt: wait for another attempt
  }

  // Valid — store (coerce numbers) and continue.
  const variable = cfg.variable;
  if (variable) {
    ctx.variables[variable] = inputType === "number" ? Number(value) : value;
  }
  return { action: "next" };
};

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

  // #1 — merge an optional global API config (base URL, shared headers).
  const global = ctx.apiConfigs?.[cfg.apiConfig] ?? null;

  const method = (cfg.method ?? "GET").toUpperCase();

  // Build URL: global base + node path/url, with variable interpolation.
  let url = interpolate(cfg.url ?? "", ctx.variables);
  if (global?.baseUrl && !/^https?:\/\//i.test(url)) {
    url = global.baseUrl.replace(/\/$/, "") + "/" + url.replace(/^\//, "");
  }

  // Query params.
  const query: Record<string, string> = {};
  for (const q of cfg.query ?? []) {
    if (q?.key) query[q.key] = interpolate(String(q.value ?? ""), ctx.variables);
  }
  const qs = new URLSearchParams(query).toString();
  if (qs) url += (url.includes("?") ? "&" : "?") + qs;

  // Headers: global shared headers + node headers.
  const headers: Record<string, string> = {};
  for (const h of global?.headers ?? []) {
    if (h?.key) headers[h.key] = interpolate(String(h.value ?? ""), ctx.variables);
  }
  for (const h of cfg.headers ?? []) {
    if (h?.key) headers[h.key] = interpolate(String(h.value ?? ""), ctx.variables);
  }

  // Body (for non-GET). Sent as JSON.
  let body: string | undefined;
  if (method !== "GET" && method !== "DELETE" && cfg.body) {
    body = interpolate(cfg.body, ctx.variables);
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
  INPUT_TYPE: inputTypeNode,
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
