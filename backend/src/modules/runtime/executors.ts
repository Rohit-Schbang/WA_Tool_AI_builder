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
  const text = interpolate(node.config.text ?? "", ctx.variables);
  await ctx.messaging.sendText(ctx.userId, text);
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


// The registry: map a nodeType to its executor.
// Adding a new node type later means adding one entry here.
export const executors: Record<string, NodeExecutor> = {
  START: start,
  SEND_MESSAGE: sendMessage,
  ASK_INPUT: askInput,
  BUTTONS: buttons,
  LIST: list,
  CONDITION: condition,
  SET_VARIABLE: setVariable,
  WAIT: wait,
  END: end,
};
