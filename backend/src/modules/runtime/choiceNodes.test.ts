import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { executors } from "./executors.js";
import type { ExecutionContext, MessagingAdapter, WorkflowNode } from "./types.js";

// A messaging adapter that records everything it was asked to send.
function recorder() {
  const sent: string[] = [];
  const adapter: MessagingAdapter = {
    async sendText(_to, text) { sent.push(text); },
    async sendButtons(_to, text) { sent.push(`[buttons] ${text}`); },
    async sendList(_to, text) { sent.push(`[list] ${text}`); },
  };
  return { sent, adapter };
}

function ctx(partial: Partial<ExecutionContext>): ExecutionContext {
  const { adapter } = recorder();
  return { userId: "u1", variables: {}, incomingText: null, messaging: adapter, ...partial } as ExecutionContext;
}

const listNode = (config: any): WorkflowNode => ({ id: "l1", nodeType: "LIST", config });

describe("choice node: store selection in a variable", () => {
  test("stores the label by default, the id when answerValue=id", async () => {
    const rows = [{ id: "r_a", label: "Sales" }, { id: "r_b", label: "Support" }];
    const c1 = ctx({ incomingText: "Sales", variables: {} });
    const r1 = await executors.LIST(listNode({ rows, answerVariable: "dept" }), c1);
    assert.deepEqual(r1, { action: "next", handle: "r_a" });
    assert.equal(c1.variables.dept, "Sales");

    const c2 = ctx({ incomingText: "Support", variables: {} });
    await executors.LIST(listNode({ rows, answerVariable: "dept", answerValue: "id" }), c2);
    assert.equal(c2.variables.dept, "r_b");
  });
});

describe("choice node: wrong-reply handling", () => {
  const rows = [{ id: "r_a", label: "Yes" }, { id: "r_b", label: "No" }];

  test("re-prompts and keeps waiting while under the retry limit", async () => {
    const { adapter, sent } = recorder();
    const c = ctx({ incomingText: "maybe", messaging: adapter, variables: {} });
    const r = await executors.LIST(listNode({ rows, invalidReply: { message: "Pick one", maxRetries: 3 } }), c);
    assert.deepEqual(r, { action: "wait" });
    assert.equal(c.variables.__invalid_l1, 1);
    assert.ok(sent.some((m) => m.includes("Pick one")));
    assert.ok(sent.some((m) => m.startsWith("[list]"))); // re-sent the options
  });

  test("routes to the fallback node after the retry limit", async () => {
    const c = ctx({ incomingText: "nope", variables: { __invalid_l1: 2 } });
    const r = await executors.LIST(listNode({ rows, invalidReply: { maxRetries: 3, goToNodeId: "help" } }), c);
    assert.deepEqual(r, { action: "next", handle: "__invalid__", goToNodeId: "help" });
    assert.equal(c.variables.__invalid_l1, undefined); // counter cleared
  });
});

describe("choice node: backtrack lock", () => {
  const rows = [{ id: "r_a", label: "Yes" }];
  test("ignores a second answer when locked", async () => {
    const node = listNode({ rows, lockAfterAnswer: true });
    const c1 = ctx({ incomingText: "Yes", variables: {} });
    const r1 = await executors.LIST(node, c1);
    assert.deepEqual(r1, { action: "next", handle: "r_a" });
    assert.equal(c1.variables.__answered_l1, true);

    const c2 = ctx({ incomingText: "Yes", variables: { __answered_l1: true } });
    const r2 = await executors.LIST(node, c2);
    assert.deepEqual(r2, { action: "wait" }); // refused, no branch
  });
});

describe("ASK_INPUT: media stored as object even for expectedType any", () => {
  test("a video reply to an 'any' question is stored as a media object", async () => {
    const node: WorkflowNode = { id: "q1", nodeType: "ASK_INPUT", config: { variable: "clip", expectedType: "any" } };
    const c = ctx({ incomingText: "", incomingType: "video", incomingMedia: { id: "mid1", mimeType: "video/mp4" } } as any);
    const r = await executors.ASK_INPUT(node, c);
    assert.deepEqual(r, { action: "next" });
    assert.equal(typeof c.variables.clip, "object");
    assert.equal(c.variables.clip.id, "mid1");
    assert.equal(c.variables.clip.type, "video");
  });
});
