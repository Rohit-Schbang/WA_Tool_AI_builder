import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import { parseImport } from "./importer.js";
import { BUILDER_TYPES } from "./capabilities.js";
import { runEngine } from "../runtime/engine.js";
import type { ExecutionContext, MessagingAdapter, WorkflowDefinition } from "../runtime/types.js";

// The sample file users download from the Import dialog.
const SAMPLE_PATH = path.resolve(process.cwd(), "..", "frontend", "public", "samples", "sample-journey.json");
const sample = () => JSON.parse(fs.readFileSync(SAMPLE_PATH, "utf8"));

describe("journey import: sample file", () => {
  test("imports cleanly with no errors or publish warnings", () => {
    const r = parseImport(sample());
    assert.equal(r.ok, true, r.ok ? "" : r.errors.join("\n"));
    if (!r.ok) return;
    assert.deepEqual(r.warnings, []);
    assert.equal(r.suggestedName, "Glow Studio – Appointment Booking");
    assert.equal(r.definition.nodes.length, sample().stats.nodes);
    assert.equal(r.definition.edges.length, sample().stats.edges);
  });

  test("uses every block type the builder offers (plus End)", () => {
    const types = new Set(sample().definition.nodes.map((n: any) => n.nodeType));
    for (const t of [...BUILDER_TYPES, "END"]) assert.ok(types.has(t), `sample is missing a ${t} node`);
  });

  test("the booking path runs end-to-end and saves the customer's name", async () => {
    const r = parseImport(sample());
    assert.ok(r.ok);
    if (!r.ok) return;
    const def = structuredClone(r.definition) as unknown as WorkflowDefinition;
    // Skip the real 3s pause so the test stays fast.
    for (const n of def.nodes) if (n.nodeType === "WAIT") n.config.seconds = 0;

    const sent: string[] = [];
    const messaging: MessagingAdapter = {
      async sendText(_to, t) { sent.push(t); },
      async sendButtons(_to, t) { sent.push(t); },
      async sendList(_to, t) { sent.push(t); },
    };
    const ctx: ExecutionContext = {
      userId: "919876543210",
      variables: { customer_phone: "919876543210", customer_name: "R" },
      incomingText: null,
      messaging,
      apiConfigs: Object.fromEntries((def as any).apiConfigs.map((c: any) => [c.name, c])),
    };

    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response(JSON.stringify({ data: { available: true } }), { status: 200 })) as any;
    try {
      let at = (await runEngine(def, "start", ctx)).pausedAtNodeId;
      assert.equal(at, "welcome");
      for (const [reply, next] of [["Book appointment", "ask_name"], ["Rohit", "choose_service"], ["Hair colour", "ask_date"]] as const) {
        ctx.incomingText = reply;
        at = (await runEngine(def, at!, ctx)).pausedAtNodeId;
        assert.equal(at, next);
      }
      ctx.incomingText = "25-12-2026";
      const done = await runEngine(def, at!, ctx);
      assert.equal(done.status, "completed");
    } finally {
      globalThis.fetch = realFetch;
    }

    assert.equal(ctx.variables.customer_name, "Rohit");
    assert.equal(ctx.variables.service, "Hair colour");
    assert.equal(ctx.variables.booking_ref, "GS-3210-25122026");
    assert.equal(ctx.variables.booking_status, "confirmed");
    assert.ok(sent.some((m) => m.includes("You're booked, Rohit")), "confirmation message not sent");
  });
});

describe("journey import: validation", () => {
  const def = () => ({
    nodes: [
      { id: "start", nodeType: "START", config: {} },
      { id: "m", nodeType: "SEND_MESSAGE", config: { text: "Hi" } },
    ],
    edges: [{ source: "start", target: "m", sourceHandle: null }],
  });

  test("accepts a bare definition without the export envelope", () => {
    const r = parseImport(def());
    assert.equal(r.ok, true);
  });

  test("rejects files that aren't journeys", () => {
    assert.equal(parseImport({ hello: "world" }).ok, false);
    assert.equal(parseImport([1, 2, 3]).ok, false);
    assert.equal(parseImport(null).ok, false);
  });

  test("rejects unknown types, duplicate ids and dangling connections", () => {
    const bad: any = def();
    bad.nodes.push({ id: "x", nodeType: "TELEPORT", config: {} });
    bad.nodes.push({ id: "m", nodeType: "SEND_MESSAGE", config: { text: "dup" } });
    bad.edges.push({ source: "m", target: "nowhere", sourceHandle: null });
    const r = parseImport(bad);
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.ok(r.errors.some((e) => /unknown type "TELEPORT"/.test(e)));
    assert.ok(r.errors.some((e) => /"m" is used more than once/.test(e)));
    assert.ok(r.errors.some((e) => /isn't in the file/.test(e)));
  });

  test("adds a missing Start and reports publish problems as warnings, not errors", () => {
    const r = parseImport({ nodes: [{ id: "m", nodeType: "SEND_MESSAGE", config: {} }], edges: [] });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.definition.nodes.filter((n) => n.nodeType === "START").length, 1);
    assert.ok(r.warnings.some((w) => /no Start node/.test(w)));
    assert.ok(r.warnings.some((w) => /missing message text/.test(w)));
  });

  test("skips declared customer_* variables (they're built in)", () => {
    const r = parseImport({ ...def(), variables: [{ name: "customer_name", type: "text" }, { name: "city", type: "text" }] });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.deepEqual(r.definition.variables.map((v) => v.name), ["city"]);
  });
});
