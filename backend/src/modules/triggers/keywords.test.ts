import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { ANY_MESSAGE, matchScore, matchesStartNode, normalizeKeyword, reservedKeys, triggerOfStart } from "./keywords.js";

describe("trigger keyword rules", () => {
  test("equivalent keywords normalise to the same value", () => {
    for (const v of ["Hi", " hi ", "HI!", "hi.", "Ｈｉ"]) assert.equal(normalizeKeyword(v), "hi");
    assert.equal(normalizeKeyword("Book   Now?"), "book now");
    assert.equal(normalizeKeyword("👋 hello"), "👋 hello");
  });

  test("duplicates inside one journey collapse; no keywords = catch-all", () => {
    assert.deepEqual(triggerOfStart({ keywords: ["Hi", "hi!", " "] }).keywords, ["hi"]);
    assert.equal(triggerOfStart({ keywords: [] }).catchAll, true);
    assert.deepEqual(reservedKeys({ nodes: [{ nodeType: "START", config: { keywords: [] } }] }), [ANY_MESSAGE]);
  });

  test("match types and scores", () => {
    const contains = triggerOfStart({ keywords: ["book"], matchType: "contains" });
    assert.equal(matchScore(contains, "Book")?.score, 3);
    assert.equal(matchScore(contains, "book now")?.score, 2);
    assert.equal(matchScore(contains, "i want to book")?.score, 1);
    const exact = triggerOfStart({ keywords: ["book"], matchType: "exact" });
    assert.equal(matchScore(exact, "book now"), null);
    assert.equal(matchScore(exact, "BOOK!")?.score, 3);
    // The never-implemented "regex" option now safely behaves as contains.
    assert.equal(matchScore(triggerOfStart({ keywords: ["book"], matchType: "regex" }), "please book")?.score, 1);
  });

  test("matchesStartNode keeps the old behaviour for single journeys", () => {
    assert.equal(matchesStartNode({ keywords: [] }, "anything"), true);
    assert.equal(matchesStartNode({ keywords: ["bonjour"] }, "Bonjour!"), true);
    assert.equal(matchesStartNode({ keywords: ["bonjour"] }, "hello"), false);
  });
});
