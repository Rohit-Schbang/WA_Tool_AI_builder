import { test, describe } from "node:test";
import assert from "node:assert/strict";
import zlib from "zlib";
import { parseDrawio, specFromPlan, timeoutMinutes, type ParsedDiagram, type FlowSpec } from "./drawio.js";
import { KNOWN_TYPES } from "./capabilities.js";
import { enforceSpec, checkFidelity, simulateBranches, buildReport } from "./fidelity.js";

// ----------------------------- fixtures -------------------------------------
const v = (id: string, label: string, y: number, style = "rounded=1;html=1;", x = 200, parent = "1") =>
  `<mxCell id="${id}" value="${label}" style="${style}" vertex="1" parent="${parent}"><mxGeometry x="${x}" y="${y}" width="140" height="60" as="geometry"/></mxCell>`;
const e = (id: string, s: string, t: string, label = "") =>
  `<mxCell id="edge${id}" value="${label}" edge="1" source="${s}" target="${t}" parent="1"><mxGeometry relative="1" as="geometry"/></mxCell>`;
const model = (cells: string) => `<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>${cells}</root></mxGraphModel>`;
const compressed = (m: string) =>
  `<mxfile><diagram id="p1">${zlib.deflateRawSync(Buffer.from(encodeURIComponent(m))).toString("base64")}</diagram></mxfile>`;

// A journey with a trigger, a system event, a question + the user's answer,
// a decision, a menu with user-choice shapes, an API step, a timeout event,
// a note, a container and an End.
const JOURNEY = model(`
${v("a", "User Clicks SEND", 0, "ellipse;html=1;")}
${v("b", "Chatbot Session Initiated", 100)}
${v("c", "&quot;Welcome to Garage Care! 🚗&quot;", 200)}
${v("d", "Ask for your email", 300, "shape=parallelogram;html=1;")}
${v("u", "User enters email", 400)}
${v("f", "Is email valid?", 500, "rhombus;html=1;")}
${v("n", "Tell user the email is invalid", 500, "rounded=1;", 450)}
${v("grp", "Services", 600, "swimlane;", 0)}
${v("h", "Show service options", 40, "rounded=1;", 20, "grp")}
${v("i", "User selects Oil Change", 820, "rounded=1;", 0)}
${v("j", "User selects Full Service", 820, "rounded=1;", 400)}
${v("k", "Confirm oil change booking", 920, "rounded=1;", 0)}
${v("l", "Create booking in CRM", 920, "rounded=1;", 400)}
${v("x", "Reminder: are you still there?", 820, "rounded=1;", 800)}
${v("note", "TODO legal copy", 0, "text;html=1;", 900)}
${v("z", "End", 1120, "ellipse;")}
${e("1", "a", "b")}${e("2", "b", "c")}${e("3", "c", "d")}${e("4", "d", "u")}${e("5", "u", "f")}
${e("6", "f", "h", "Yes")}${e("7", "f", "n")}
<mxCell id="7l" value="No" style="edgeLabel;" vertex="1" connectable="0" parent="edge7"><mxGeometry relative="1" as="geometry"/></mxCell>
${e("8", "n", "d")}
${e("9", "h", "i")}${e("10", "h", "j")}${e("13", "h", "x", "No reply in 5 min")}
${e("11", "i", "k")}${e("12", "j", "l")}${e("14", "k", "z")}${e("15", "l", "z")}
<mxCell id="dangling" edge="1" source="k" parent="1"><mxGeometry relative="1" as="geometry"/></mxCell>
`);

// The plan an AI would ideally return for JOURNEY.
const PLAN = [
  { title: "Start", nodeType: "START", sourceIds: ["start", "d_b"], confidence: "high" },
  { title: "Welcome", nodeType: "SEND_MESSAGE", sourceIds: ["d_c"], text: "Welcome to Garage Care! 🚗", textSource: "verbatim" },
  { title: "Ask email", nodeType: "ASK_INPUT", sourceIds: ["d_d", "d_u"], text: "What's your email?", textSource: "written", variable: "email", validationType: "email" },
  { title: "Email valid?", nodeType: "CONDITION", sourceIds: ["d_f"] },
  { title: "Invalid email", nodeType: "SEND_MESSAGE", sourceIds: ["d_n"], text: "That email doesn't look right.", textSource: "written" },
  { title: "Services", nodeType: "SEND_MESSAGE", sourceIds: ["d_h", "d_i", "d_j"], text: "Pick a service:", textSource: "written" },
  { title: "Oil change booked", nodeType: "SEND_MESSAGE", sourceIds: ["d_k"], text: "Oil change booked!", textSource: "written" },
  { title: "Create booking", nodeType: "API_REQUEST", sourceIds: ["d_l"] },
  { title: "Reminder", nodeType: "SEND_MESSAGE", sourceIds: ["d_x"], text: "Are you still there?", textSource: "written" },
  { title: "Note", nodeType: "SKIP", sourceIds: ["d_note"], detail: "annotation" },
];

function goodBuild(spec: FlowSpec) {
  // What a faithful build looks like (used to test the checks and simulator).
  const cfg: Record<string, any> = {
    start: { name: "Start" },
    d_c: { name: "Welcome", text: "Welcome to Garage Care! 🚗" },
    d_d: { name: "Ask email", text: "What's your email?", variable: "email", validationType: "email" },
    d_f: { name: "Email valid?", field: "email_ok", operator: "equals", value: "yes" },
    d_n: { name: "Invalid email", text: "That email doesn't look right." },
    d_h: { name: "Services", text: "Pick a service:", buttons: [{ id: "oil", label: "Oil Change", kind: "cta" }, { id: "full", label: "Full Service", kind: "cta" }] },
    d_k: { name: "Oil change booked", text: "Oil change booked!" },
    d_l: { name: "Create booking", apiConfig: "" },
    d_x: { name: "Reminder", text: "Are you still there?" },
  };
  const nodes = spec.nodes.map((n) => ({ id: n.id, nodeType: n.nodeType, config: { ...cfg[n.id] } }));
  const handle: Record<string, string | null> = { "d_f|d_h": "true", "d_f|d_n": "else", "d_h|d_k": "oil", "d_h|d_l": "full" };
  const edges = spec.edges
    .filter((x) => x.kind !== "fallback")
    .map((x, i) => ({ id: `e${i}`, source: x.source, target: x.target, sourceHandle: handle[`${x.source}|${x.target}`] ?? null }));
  // the API node's failure path and success path
  edges.push({ id: "eapi_t", source: "d_l", target: "d_l_else", sourceHandle: "else" });
  nodes.push({ id: "d_l_else", nodeType: "SEND_MESSAGE", config: { name: "Booking failed", text: "Sorry, booking failed." } });
  return { variables: [{ name: "email_ok" }], nodes, edges };
}

// ----------------------------- parsing --------------------------------------
describe("parseDrawio", () => {
  const d = parseDrawio(compressed(JOURNEY));

  test("decodes a compressed diagram", () => {
    assert.equal(d.pages, 1);
    assert.ok(d.shapes.length > 0);
  });

  test("cleans HTML/entity labels and reads wrapped labels", () => {
    assert.equal(d.shapes.find((s) => s.id === "d_c")?.label, `"Welcome to Garage Care! 🚗"`);
  });

  test("detects the start shape, END, and drops containers + floating notes", () => {
    assert.equal(d.startShapeId, "start");
    assert.ok(d.shapes.find((s) => s.id === "d_z")?.isEnd);
    assert.ok(!d.shapes.some((s) => s.id === "d_grp"), "swimlane container must not be a shape");
    assert.ok(!d.shapes.some((s) => s.id === "d_note"), "unconnected text note must be dropped");
  });

  test("reads edge labels from separate label cells and warns about dangling arrows", () => {
    assert.ok(d.edges.some((x) => x.source === "d_f" && x.target === "d_n" && x.label === "No"));
    assert.ok(d.warnings.some((w) => /aren't attached/.test(w)));
  });

  test("hints user actions / system events instead of messages", () => {
    assert.match(d.shapes.find((s) => s.id === "d_u")!.suggested, /^USER ACTION/);
    assert.match(d.shapes.find((s) => s.id === "d_b")!.suggested, /^SYSTEM EVENT/);
    assert.match(d.shapes.find((s) => s.id === "d_l")!.suggested, /^API_REQUEST/);
    assert.equal(d.shapes.find((s) => s.id === "d_f")!.suggested, "VALIDATE");
  });

  test("handles uncompressed files and garbage input", () => {
    assert.ok(parseDrawio(`<mxfile><diagram>${JOURNEY}</diagram></mxfile>`).shapes.length > 0);
    const bad = parseDrawio("not a diagram at all");
    assert.equal(bad.shapes.length, 0);
    assert.ok(bad.warnings.length > 0);
  });

  test("timeout minutes are parsed and clamped to the app's 1–10 min range", () => {
    assert.deepEqual(timeoutMinutes("No reply in 5 min"), { minutes: 5, clamped: false });
    assert.equal(timeoutMinutes("no response for 2 hours").clamped, true);
    assert.equal(timeoutMinutes("no response for 2 hours").minutes, 10);
  });
});

// ----------------------------- mapping --------------------------------------
describe("specFromPlan", () => {
  const d = parseDrawio(compressed(JOURNEY));
  const spec = specFromPlan(PLAN, d, KNOWN_TYPES);
  const has = (s: string, t: string) => spec.edges.some((x) => x.source === s && x.target === t);

  test("one START that absorbs the trigger + session event", () => {
    const starts = spec.nodes.filter((n) => n.nodeType === "START");
    assert.equal(starts.length, 1);
    assert.deepEqual(starts[0].shapeIds.sort(), ["d_b", "start"]);
  });

  test("reconnects through merged shapes (start → welcome, question → decision)", () => {
    assert.ok(has("start", "d_c"));
    assert.ok(has("d_d", "d_f"));
  });

  test("user-choice shapes become branch labels on the menu", () => {
    const toOil = spec.edges.find((x) => x.source === "d_h" && x.target === "d_k");
    assert.equal(toOil?.label, "User selects Oil Change");
  });

  test("timeout connector becomes a no-reply event, not a normal connection", () => {
    const fb = spec.edges.find((x) => x.source === "d_h" && x.target === "d_x");
    assert.equal(fb?.kind, "fallback");
    assert.equal(fb?.minutes, 5);
  });

  test("every non-END shape is mapped or explicitly skipped; text fields carry over", () => {
    for (const s of d.shapes.filter((x) => !x.isEnd)) {
      const mapped = spec.nodes.some((n) => n.shapeIds.includes(s.id)) || spec.skipped.some((k) => k.id === s.id);
      assert.ok(mapped, `shape ${s.id} unaccounted for`);
    }
    assert.equal(spec.nodes.find((n) => n.id === "d_c")?.textSource, "verbatim");
    assert.equal(spec.nodes.find((n) => n.id === "d_d")?.variable, "email");
  });

  test("shapes missing from a bad plan are still accounted for", () => {
    const partial = specFromPlan([{ title: "Start", nodeType: "START", sourceIds: ["start"] }], d, KNOWN_TYPES);
    for (const s of d.shapes.filter((x) => !x.isEnd)) {
      const mapped = partial.nodes.some((n) => n.shapeIds.includes(s.id)) || partial.skipped.some((k) => k.id === s.id);
      assert.ok(mapped, `shape ${s.id} unaccounted for`);
    }
    assert.ok(partial.nodes.some((n) => n.confidence === "low"), "auto-mapped shapes are flagged low confidence");
  });

  test("splits a bot step that the plan wrongly merged (event target)", () => {
    // The AI folds the timeout destination "Reminder" into the menu block.
    const bad = PLAN.filter((s) => s.title !== "Reminder").map((s) =>
      s.title === "Services" ? { ...s, sourceIds: [...s.sourceIds, "d_x"] } : s);
    const s2 = specFromPlan(bad, d, KNOWN_TYPES);
    assert.ok(s2.nodes.some((n) => n.id === "d_x" && n.shapeIds.includes("d_x")), "Reminder is its own block");
    assert.ok(!s2.nodes.find((n) => n.id === "d_h")!.shapeIds.includes("d_x"));
    assert.equal(s2.edges.find((x) => x.source === "d_h" && x.target === "d_x")?.kind, "fallback");
  });

  test("unknown node types are flagged, not invented", () => {
    const s = specFromPlan([...PLAN.slice(0, 1), { title: "X", nodeType: "TELEPORT", sourceIds: ["d_c"] }], d, KNOWN_TYPES);
    const n = s.nodes.find((x) => x.id === "d_c")!;
    assert.equal(n.nodeType, "SEND_MESSAGE");
    assert.equal(n.confidence, "low");
  });
});

// ----------------------------- fidelity -------------------------------------
describe("fidelity checks", () => {
  const d: ParsedDiagram = parseDrawio(compressed(JOURNEY));
  const spec = specFromPlan(PLAN, d, KNOWN_TYPES);

  test("a faithful build passes the static checks (only review warnings)", () => {
    const { def } = enforceSpec(goodBuild(spec), spec, d);
    const items = checkFidelity(def, spec, d);
    const failed = items.filter((i) => i.status === "failed");
    assert.deepEqual(failed.map((f) => f.message), []);
    assert.ok(items.some((i) => i.status === "warning" && /API config/.test(i.message)));
  });

  test("a menu whose button paths are swapped fails (not just a warning)", () => {
    const b = goodBuild(spec);
    for (const x of b.edges) if (x.source === "d_h") x.sourceHandle = x.target === "d_k" ? "full" : "oil";
    const items = checkFidelity(enforceSpec(b, spec, d).def, spec, d);
    assert.ok(items.some((i) => i.category === "branches" && i.status === "failed" && /swapped/.test(i.message)));
  });

  test("enforceSpec restores verbatim text, adds traceability and the no-reply event", () => {
    const b = goodBuild(spec);
    b.nodes.find((n) => n.id === "d_c")!.config.text = "Hi there, welcome!"; // AI reworded it
    const { def, corrections } = enforceSpec(b, spec, d);
    const welcome = def.nodes.find((n) => n.id === "d_c")!;
    assert.equal(welcome.config.text, "Welcome to Garage Care! 🚗");
    assert.ok(corrections.some((c) => /exact diagram text/.test(c)));
    assert.ok(Array.isArray(welcome.config.sourceRef.drawioIds));
    const menu = def.nodes.find((n) => n.id === "d_h")!;
    assert.deepEqual(menu.config.fallback, { enabled: true, minutes: 5, goToNodeId: "d_x" });
  });

  test("enforceSpec removes fabricated blocks and connections", () => {
    const b = goodBuild(spec);
    b.nodes.push({ id: "made_up", nodeType: "SEND_MESSAGE", config: { text: "Extra!" } });
    b.edges.push({ id: "x1", source: "d_c", target: "made_up", sourceHandle: null });
    b.edges.push({ id: "x2", source: "d_c", target: "d_k", sourceHandle: null });
    const { def } = enforceSpec(b, spec, d);
    assert.ok(!def.nodes.some((n) => n.id === "made_up"));
    assert.ok(!def.edges.some((x) => x.source === "d_c" && x.target === "d_k"));
  });

  test("detects a missing connection and a missing block", () => {
    const b = goodBuild(spec);
    b.edges = b.edges.filter((x) => !(x.source === "d_d" && x.target === "d_f"));
    b.nodes = b.nodes.filter((n) => n.id !== "d_n");
    const items = checkFidelity(enforceSpec(b, spec, d).def, spec, d);
    assert.ok(items.some((i) => i.status === "failed" && /Missing connection/.test(i.message)));
    assert.ok(items.some((i) => i.status === "failed" && /Missing block “Invalid email”/.test(i.message)));
  });

  test("detects a reversed Yes/No branch", () => {
    const b = goodBuild(spec);
    for (const x of b.edges) {
      if (x.source === "d_f") x.sourceHandle = x.target === "d_h" ? "else" : "true";
    }
    const items = checkFidelity(enforceSpec(b, spec, d).def, spec, d);
    assert.ok(items.some((i) => i.status === "failed" && /reversed/.test(i.message)));
  });

  test("events are checked against the source diagram, not just the plan", () => {
    const b = goodBuild(spec);
    const { def } = enforceSpec(b, spec, d);
    delete def.nodes.find((n) => n.id === "d_h")!.config.fallback; // event lost after enforcement
    const items = checkFidelity(def, spec, d);
    assert.ok(items.some((i) => i.category === "events" && i.status === "failed" && /No reply in 5 min/.test(i.message)));
  });

  test("detects a question that doesn't store its answer", () => {
    const b = goodBuild(spec);
    delete b.nodes.find((n) => n.id === "d_d")!.config.variable;
    const s2: FlowSpec = { ...spec, nodes: spec.nodes.map((n) => (n.id === "d_d" ? { ...n, variable: undefined } : n)) };
    const items = checkFidelity(enforceSpec(b, s2, d).def, s2, d);
    assert.ok(items.some((i) => i.category === "questions" && i.status === "failed"));
  });

  test("detects a button wired to the wrong path", () => {
    const b = goodBuild(spec);
    for (const x of b.edges) if (x.source === "d_h") x.sourceHandle = x.target === "d_k" ? "full" : "oil";
    const items = checkFidelity(enforceSpec(b, spec, d).def, spec, d);
    assert.ok(items.some((i) => i.category === "branches" && i.status !== "passed" && /Full Service/.test(i.message)));
  });
});

// ----------------------------- simulation -----------------------------------
describe("simulated execution (real executors, no side effects)", () => {
  const d = parseDrawio(compressed(JOURNEY));
  const spec = specFromPlan(PLAN, d, KNOWN_TYPES);

  test("each button reply, decision outcome, API result and validation behaves as the diagram says", async () => {
    const { def } = enforceSpec(goodBuild(spec), spec, d);
    const items = await simulateBranches(def, spec, d);
    const failed = items.filter((i) => i.status === "failed");
    assert.deepEqual(failed.map((f) => f.message), []);
    assert.ok(items.some((i) => i.status === "passed" && /Reply “Oil Change”/.test(i.message)));
    assert.ok(items.some((i) => i.status === "passed" && /mocked API success/.test(i.message)));
    assert.ok(items.some((i) => i.status === "passed" && /re-asks on an invalid email/.test(i.message)));
    assert.ok(items.some((i) => i.status === "not_tested" && /No-reply timer/.test(i.message)));
  });

  test("catches a button routed to the wrong destination at runtime", async () => {
    const b = goodBuild(spec);
    for (const x of b.edges) if (x.source === "d_h") x.sourceHandle = x.target === "d_k" ? "full" : "oil";
    const items = await simulateBranches(enforceSpec(b, spec, d).def, spec, d);
    assert.ok(items.some((i) => i.status === "failed" && /expected/.test(i.message)));
  });

  test("a regex VALIDATE block is simulated with a valid and an invalid sample", async () => {
    const b = goodBuild(spec);
    const n = b.nodes.find((x) => x.id === "d_f")!;
    n.nodeType = "VALIDATE";
    n.config = { name: "Email valid?", mode: "regex", value: "{{email}}", pattern: "^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$" };
    const s2: FlowSpec = { ...spec, nodes: spec.nodes.map((x) => (x.id === "d_f" ? { ...x, nodeType: "VALIDATE" } : x)) };
    const items = await simulateBranches(enforceSpec(b, s2, d).def, s2, d);
    const v = items.filter((i) => /Email valid\?/.test(i.message));
    assert.equal(v.filter((i) => i.status === "passed").length, 2);
  });

  test("the real fetch is restored after mocked API simulation", async () => {
    const before = globalThis.fetch;
    await simulateBranches(enforceSpec(goodBuild(spec), spec, d).def, spec, d);
    assert.equal(globalThis.fetch, before);
  });

  test("report summarises counts and never claims success with failures", async () => {
    const b = goodBuild(spec);
    b.edges = b.edges.filter((x) => !(x.source === "d_d" && x.target === "d_f"));
    const { def } = enforceSpec(b, spec, d);
    const items = [...checkFidelity(def, spec, d), ...(await simulateBranches(def, spec, d))];
    const report = buildReport(def, spec, d, items, [], 0);
    assert.equal(report.status, "failed");
    assert.ok(report.summary.connectionsVerified < report.summary.connectionsTotal);
    assert.equal(report.summary.mappedShapes, report.summary.sourceShapes);
    assert.ok(report.manualActions.some((m) => /Missing connection/.test(m)));
  });
});
