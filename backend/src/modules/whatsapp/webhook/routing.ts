// Which journey answers an inbound message on the workspace's (single) master
// WhatsApp number? Every live journey (active + published) shares it.
//
//   1. The user is mid-conversation with a live journey -> that journey (the
//      most recently active one if several).
//   2. Otherwise the journeys whose START trigger matches the message. Journeys
//      WITH keywords beat catch-all journeys (no keywords), then the most
//      recently updated journey wins.
//   3. Nothing matched -> nobody answers (reason is logged).

export interface RouteCandidate {
  chatbotId: string;
  name: string;
  updatedAt: Date;
  hasKeywords: boolean;
  matches: boolean; // START trigger matches this message
}

export type RouteResult = { chatbotId: string; reason: string } | { chatbotId: null; reason: string };

export function pickJourney(live: RouteCandidate[], ongoingChatbotIds: string[]): RouteResult {
  if (!live.length) return { chatbotId: null, reason: "no journey is active and published" };

  const ongoing = ongoingChatbotIds.find((id) => live.some((c) => c.chatbotId === id));
  if (ongoing) return { chatbotId: ongoing, reason: "continuing the user's current journey" };

  const matched = live
    .filter((c) => c.matches)
    .sort((a, b) => Number(b.hasKeywords) - Number(a.hasKeywords) || b.updatedAt.getTime() - a.updatedAt.getTime());
  if (matched.length) {
    const p = matched[0];
    return { chatbotId: p.chatbotId, reason: p.hasKeywords ? `trigger keyword of "${p.name}"` : `catch-all journey "${p.name}"` };
  }
  return { chatbotId: null, reason: `the message matches no trigger of the ${live.length} live journey(s)` };
}
