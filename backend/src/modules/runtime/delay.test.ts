import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { runEngine } from "./engine.js";
import { ConsoleAdapter } from "../messaging/adapters.js";
import type { ExecutionContext, MessagingAdapter, WorkflowDefinition } from "./types.js";

// Start -> "First" -> Delay 2s -> "Second" (same shape as the "test" bot).
const def: WorkflowDefinition = {
  nodes: [
    { id: "start", nodeType: "START", config: {} },
    { id: "m1", nodeType: "SEND_MESSAGE", config: { text: "First" } },
    { id: "w", nodeType: "WAIT", config: { seconds: 2 } },
    { id: "m2", nodeType: "SEND_MESSAGE", config: { text: "Second" } },
  ],
  edges: [
    { id: "e1", source: "start", target: "m1", sourceHandle: null },
    { id: "e2", source: "m1", target: "w", sourceHandle: null },
    { id: "e3", source: "w", target: "m2", sourceHandle: null },
  ],
};

describe("Delay block", () => {
  test("live path: messages are sent apart, with the real pause between them", async () => {
    const t0 = Date.now();
    const sentAt: Record<string, number> = {};
    const messaging: MessagingAdapter = { async sendText(_to, text) { sentAt[text] = Date.now() - t0; } };
    const ctx: ExecutionContext = { userId: "u", variables: {}, incomingText: null, messaging };
    const r = await runEngine(def, "start", ctx);
    assert.equal(r.status, "completed");
    assert.ok(sentAt.First < 500, `first message should go out at once (was ${sentAt.First}ms)`);
    assert.ok(sentAt.Second >= 1900, `second message should wait ~2s (was ${sentAt.Second}ms)`);
  });

  test("web tester: no server-side sleep, the delay is returned as a marker in order", async () => {
    const adapter = new ConsoleAdapter();
    const ctx: ExecutionContext = { userId: "u", variables: {}, incomingText: null, messaging: adapter, simulateDelays: true };
    const t0 = Date.now();
    const r = await runEngine(def, "start", ctx);
    assert.equal(r.status, "completed");
    assert.ok(Date.now() - t0 < 500, "the tester run must not sleep on the server");
    assert.deepEqual(
      adapter.sent.map((m) => (m.delaySeconds != null ? `delay:${m.delaySeconds}` : m.text)),
      ["First", "delay:2", "Second"]
    );
  });
});
