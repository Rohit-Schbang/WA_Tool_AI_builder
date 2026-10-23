import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { pickInboundConnection, type RouteCandidate } from "./routing.js";
import { triggerOfStart } from "../../triggers/keywords.js";

const bot = (
  id: string,
  isActive: boolean,
  live: boolean,
  updated: string,
  keywords: string[] = [],
  matchType = "contains",
  token = true
): RouteCandidate => ({
  chatbotId: id,
  accessToken: token ? "EAAtoken" : null,
  chatbot: { name: id, isActive, activeVersionId: live ? `v_${id}` : null, updatedAt: new Date(updated) },
  trigger: triggerOfStart({ keywords, matchType }),
});

describe("inbound routing on a shared WhatsApp number", () => {
  test("one live journey answers, whatever the order (yesterday's real setup)", () => {
    const shared = [
      bot("schbang", false, true, "2026-10-21", ["hi"]),
      bot("test", true, true, "2026-10-22", ["bonjour"]),
      bot("glow", false, true, "2026-10-22T13:00:00Z", ["hi"]),
      bot("bot-ai-check", false, false, "2026-10-23"),
    ];
    for (const order of [shared, [...shared].reverse()]) {
      assert.equal(pickInboundConnection(order, [], "bonjour").pick?.chatbotId, "test");
    }
  });

  test("nobody answers when no journey is live, or there's no token", () => {
    assert.equal(pickInboundConnection([bot("a", false, true, "2026-10-21"), bot("b", true, false, "2026-10-22")], [], "hi").pick, null);
    assert.equal(pickInboundConnection([bot("x", true, true, "2026-10-22", [], "contains", false)], [], "hi").pick, null);
  });

  const two = [
    bot("booking", true, true, "2026-10-20", ["book"]),
    bot("support", true, true, "2026-10-22", ["help", "book help"]),
  ];

  test("each journey starts from its own keyword (case/punctuation insensitive)", () => {
    assert.equal(pickInboundConnection(two, [], "Book!").pick?.chatbotId, "booking");
    assert.equal(pickInboundConnection(two, [], "  HELP ").pick?.chatbotId, "support");
  });

  test("the more specific keyword wins an overlap", () => {
    // "book help" (exact) beats "book" (starts-with).
    assert.equal(pickInboundConnection(two, [], "book help").pick?.chatbotId, "support");
  });

  test("a message matching no keyword starts nothing (no catch-all)", () => {
    const r = pickInboundConnection(two, [], "good morning");
    assert.equal(r.pick, null);
  });

  test("a catch-all journey (no keywords) gets messages no keyword matched", () => {
    const withAny = [...two, bot("welcome", true, true, "2026-10-19", [])];
    assert.equal(pickInboundConnection(withAny, [], "good morning").pick?.chatbotId, "welcome");
    assert.equal(pickInboundConnection(withAny, [], "help").pick?.chatbotId, "support");
  });

  test("mid-conversation answers stay in the current journey", () => {
    // "can you help me" CONTAINS support's keyword, but it's an answer, not a switch.
    const r = pickInboundConnection(two, ["booking"], "can you help me");
    assert.ok(r.pick);
    if (!r.pick) return;
    assert.equal(r.pick.chatbotId, "booking");
    assert.equal(r.restart, false);
    assert.deepEqual(r.closeChatbotIds, []);
  });

  test("sending another journey's exact keyword switches journeys and closes the old one", () => {
    const r = pickInboundConnection(two, ["booking"], "help");
    assert.ok(r.pick);
    if (!r.pick) return;
    assert.equal(r.pick.chatbotId, "support");
    assert.equal(r.restart, true);
    assert.deepEqual(r.closeChatbotIds, ["booking"]);
  });

  test("sending your own journey's keyword mid-conversation doesn't restart it", () => {
    const r = pickInboundConnection(two, ["booking"], "book");
    assert.ok(r.pick);
    if (!r.pick) return;
    assert.equal(r.pick.chatbotId, "booking");
    assert.equal(r.restart, false);
  });
});
