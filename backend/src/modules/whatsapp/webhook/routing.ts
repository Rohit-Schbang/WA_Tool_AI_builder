// Which journey (chatbot) should answer an inbound WhatsApp message?
//
// Several journeys can share one WhatsApp number. Each runs independently (its
// own conversation, variables and position) and is started by its own trigger
// keyword. Only LIVE journeys (active + published, with a token) can answer.
//
//   1. One live journey            -> it (its own trigger rules then apply).
//   2. User is mid-conversation    -> stay in that journey, UNLESS the whole
//      message is exactly another journey's keyword: then switch to that one
//      (restart it) and close the old conversation. Requiring an exact match
//      here stops a normal answer that merely CONTAINS a keyword ("this", "hi")
//      from yanking the user out of their journey.
//   3. Not in a conversation       -> the best keyword match: exact beats
//      starts-with beats contains; a longer keyword beats a shorter one; then
//      the most recently updated journey.
//   4. No keyword matched          -> the catch-all journey (no keywords), if any.
//   5. Otherwise nobody answers, with a reason for the server log.

import { matchScore, type Trigger } from "../../triggers/keywords.js";

export interface RouteCandidate {
  chatbotId: string;
  accessToken: string | null;
  chatbot: { name: string; isActive: boolean; activeVersionId: string | null; updatedAt: Date };
  trigger?: Trigger;   // from the LIVE version's START node
}

export type RouteResult<T extends RouteCandidate> =
  | {
      pick: T;
      liveCount: number;
      // Start the picked journey from the beginning (switching journeys).
      restart: boolean;
      // Other journeys whose open conversation with this user should close.
      closeChatbotIds: string[];
      reason: string;
    }
  | { pick: null; reason: string };

const newestFirst = <T extends RouteCandidate>(a: T, b: T) => b.chatbot.updatedAt.getTime() - a.chatbot.updatedAt.getTime();

export function pickInboundConnection<T extends RouteCandidate>(
  candidates: T[],
  // Live journeys this user has an unfinished conversation with, newest first.
  ongoingBotIds: string[] = [],
  text = ""
): RouteResult<T> {
  const usable = candidates.filter((c) => !!c.accessToken);
  if (!usable.length) return { pick: null, reason: "no connection with an access token for this number" };

  const live = usable.filter((c) => c.chatbot.isActive && !!c.chatbot.activeVersionId);
  if (!live.length) {
    return { pick: null, reason: `none of the ${usable.length} journey(s) on this number is active and published` };
  }
  if (live.length === 1) {
    return { pick: live[0], liveCount: 1, restart: false, closeChatbotIds: [], reason: "only live journey on this number" };
  }

  // Score every live journey's trigger against the message.
  const scored = live
    .map((c) => ({ c, m: c.trigger ? matchScore(c.trigger, text) : null }))
    .filter((x): x is { c: T; m: { score: number; length: number } } => !!x.m)
    .sort((a, b) => b.m.score - a.m.score || b.m.length - a.m.length || newestFirst(a.c, b.c));

  const ongoing = ongoingBotIds.map((id) => live.find((c) => c.chatbotId === id)).filter((c): c is T => !!c);
  const current = ongoing[0];

  if (current) {
    const switchTo = scored.find((x) => x.m.score === 3 && x.c.chatbotId !== current.chatbotId);
    if (switchTo) {
      return {
        pick: switchTo.c,
        liveCount: live.length,
        restart: true,
        closeChatbotIds: ongoing.filter((c) => c.chatbotId !== switchTo.c.chatbotId).map((c) => c.chatbotId),
        reason: `trigger keyword of "${switchTo.c.chatbot.name}" (switching from "${current.chatbot.name}")`,
      };
    }
    return { pick: current, liveCount: live.length, restart: false, closeChatbotIds: [], reason: "continuing the user's current journey" };
  }

  if (scored.length) {
    return { pick: scored[0].c, liveCount: live.length, restart: false, closeChatbotIds: [], reason: `trigger keyword of "${scored[0].c.chatbot.name}"` };
  }

  const catchAll = live.filter((c) => c.trigger?.catchAll).sort(newestFirst)[0];
  if (catchAll) {
    return { pick: catchAll, liveCount: live.length, restart: false, closeChatbotIds: [], reason: `catch-all journey "${catchAll.chatbot.name}"` };
  }

  return { pick: null, reason: `the message matches no trigger keyword of the ${live.length} live journeys on this number` };
}
