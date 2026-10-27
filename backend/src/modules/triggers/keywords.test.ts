import { test } from "node:test";
import assert from "node:assert/strict";
import { ANY_MESSAGE, findConflicts, normalizeKeyword, reservedKeys, type HolderJourney } from "./keywords.js";

const def = (keywords?: unknown[]) => ({ nodes: [{ id: "s", nodeType: "START", config: keywords ? { keywords } : {} }], edges: [] });
const holder = (id: string, keys: string[], isActive = true): HolderJourney => ({ chatbotId: id, name: id, isActive, isLive: true, keys: new Set(keys) });

test("keywords: normalisation treats variants as the same keyword", () => {
  for (const v of ["Hi", " hi ", "HI!", "hi."]) assert.equal(normalizeKeyword(v), "hi");
  assert.equal(normalizeKeyword("Book   Now"), "book now");
});

test("keywords: reserved keys of a START node", () => {
  assert.deepEqual(reservedKeys(def(["Hi", "hi!", "Hello", ""])), ["hi", "hello"]);
  assert.deepEqual(reservedKeys(def()), [ANY_MESSAGE]); // no keywords = catch-all
  assert.deepEqual(reservedKeys(def([" "])), [ANY_MESSAGE]);
  assert.deepEqual(reservedKeys({ nodes: [], edges: [] }), []); // no START = nothing
});

test("keywords: conflicts against other journeys", () => {
  const others = [holder("a", ["hi", "book"]), holder("b", ["hola"], false), holder("c", [ANY_MESSAGE])];
  const c = findConflicts(["hi", "hola", "menu"], others);
  assert.deepEqual(c.map((x) => [x.keyword, x.chatbotId, x.isActive]), [["hi", "a", true], ["hola", "b", false]]);
  const any = findConflicts([ANY_MESSAGE], others);
  assert.equal(any.length, 1);
  assert.equal(any[0].catchAll, true);
  assert.deepEqual(findConflicts(["menu"], others), []);
});
