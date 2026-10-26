import { test } from "node:test";
import assert from "node:assert/strict";
import { pickJourney, type RouteCandidate } from "./routing.js";

const c = (id: string, o: Partial<RouteCandidate> = {}): RouteCandidate => ({
  chatbotId: id, name: id, updatedAt: new Date("2026-10-01"), hasKeywords: true, matches: false, ...o,
});

test("routing: nobody live -> no answer", () => {
  assert.equal(pickJourney([], []).chatbotId, null);
});

test("routing: ongoing conversation wins over a keyword match", () => {
  const r = pickJourney([c("a", { matches: true }), c("b")], ["b"]);
  assert.equal(r.chatbotId, "b");
});

test("routing: ignores ongoing conversations with journeys that aren't live", () => {
  const r = pickJourney([c("a", { matches: true })], ["gone"]);
  assert.equal(r.chatbotId, "a");
});

test("routing: keyword journey beats catch-all, newest wins ties", () => {
  const live = [
    c("catch", { hasKeywords: false, matches: true, updatedAt: new Date("2026-10-20") }),
    c("old", { matches: true, updatedAt: new Date("2026-10-01") }),
    c("new", { matches: true, updatedAt: new Date("2026-10-10") }),
  ];
  assert.equal(pickJourney(live, []).chatbotId, "new");
  assert.equal(pickJourney([live[0]], []).chatbotId, "catch");
});

test("routing: no match -> no answer", () => {
  assert.equal(pickJourney([c("a"), c("b")], []).chatbotId, null);
});
