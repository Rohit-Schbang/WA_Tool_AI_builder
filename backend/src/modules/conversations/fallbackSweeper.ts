import { prisma } from "../../infra/prisma.js";
import { runEngine } from "../runtime/engine.js";
import { WorkflowDefinition, ExecutionContext } from "../runtime/types.js";
import { WhatsAppAdapter, ConsoleAdapter } from "../messaging/adapters.js";
import { LoggingAdapter } from "../messaging/loggingAdapters.js";
import type { MessagingAdapter } from "../runtime/types.js";

// #11-adjacent (no-reply fallback): a lightweight in-process sweeper that
// periodically finds conversations stuck WAITING_FOR_INPUT past their node's
// configured timeout and fires the fallback (message and/or jump to a node).
//
// This is the pragmatic MVP: a single setInterval, fine for one backend
// instance. For multi-instance we'd move this to a shared job queue (BullMQ),
// which is already on the V2.3 roadmap.

const SWEEP_INTERVAL_MS = 20_000; // check every 20s
let timer: NodeJS.Timeout | null = null;

// Build the right outbound adapter for a chatbot (real WhatsApp if connected,
// else a no-op console adapter so the fallback still advances the flow).
async function buildAdapter(chatbotId: string): Promise<MessagingAdapter> {
  const conn = await prisma.connection.findUnique({ where: { chatbotId } });
  if (conn?.phoneNumberId && conn?.accessToken && conn.status === "CONNECTED") {
    return new WhatsAppAdapter(conn.phoneNumberId, conn.accessToken);
  }
  return new ConsoleAdapter();
}

async function sweepOnce() {
  const now = Date.now();

  // Candidate conversations: waiting for input, updated a while ago.
  // We fetch a bounded batch and filter precisely in JS (timeout varies
  // per node, so we can't express it fully in the query).
  const waiting = await prisma.conversation.findMany({
    where: { status: "WAITING_FOR_INPUT" },
    orderBy: { updatedAt: "asc" },
    take: 100,
  });

  for (const convo of waiting) {
    try {
      const version = await prisma.workflowVersion.findUnique({
        where: { id: convo.workflowVersionId },
      });
      if (!version) continue;

      const definition = version.definition as unknown as WorkflowDefinition;
      const node = definition.nodes.find((n) => n.id === convo.currentNodeId);
      const fb = (node?.config as any)?.fallback;
      if (!fb?.enabled || !convo.currentNodeId) continue;

      const minutes = Math.max(1, Math.min(10, Number(fb.minutes ?? 5)));
      const idleMs = now - new Date(convo.updatedAt).getTime();
      if (idleMs < minutes * 60_000) continue; // not idle long enough yet

      const variables = (convo.variables as Record<string, any>) ?? {};
      const firedKey = `__fallbackFired_${convo.currentNodeId}`;
      if (variables[firedKey]) continue; // already fired for this node

      // --- Fire the fallback ---
      const rawAdapter = await buildAdapter(convo.chatbotId);
      const messaging = new LoggingAdapter(rawAdapter, convo.id);

      // 1) Send the fallback message, if any.
      if (fb.message) {
        const text = interpolate(String(fb.message), variables);
        await messaging.sendText(convo.waUserId, text);
      }

      // Mark fired so we don't repeat, regardless of what happens next.
      variables[firedKey] = true;

      // 2) Optionally jump to another node and run the flow from there.
      if (fb.goToNodeId) {
        const context: ExecutionContext = {
          userId: convo.waUserId,
          variables,
          incomingText: null,
          messaging,
        };
        const result = await runEngine(definition, fb.goToNodeId, context);
        await prisma.conversation.update({
          where: { id: convo.id },
          data: {
            currentNodeId: result.pausedAtNodeId,
            variables: context.variables,
            status: result.status === "completed" ? "COMPLETED" : "WAITING_FOR_INPUT",
            lastMessageAt: new Date(),
          },
        });
      } else {
        // No jump: just persist the fired flag (and message was sent).
        await prisma.conversation.update({
          where: { id: convo.id },
          data: { variables, lastMessageAt: new Date() },
        });
      }

      console.log(`[fallback] fired for conversation ${convo.id} at node ${convo.currentNodeId}`);
    } catch (err) {
      console.error("[fallback] error sweeping conversation", convo.id, err);
    }
  }
}

// Minimal {{var}} interpolation (kept local to avoid importing executor internals).
function interpolate(text: string, variables: Record<string, any>): string {
  return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key) => variables[key] ?? "");
}

export function startFallbackSweeper() {
  if (timer) return;
  timer = setInterval(() => {
    sweepOnce().catch((e) => console.error("[fallback] sweep failed", e));
  }, SWEEP_INTERVAL_MS);
  console.log(`[fallback] sweeper started (every ${SWEEP_INTERVAL_MS / 1000}s)`);
}

export function stopFallbackSweeper() {
  if (timer) { clearInterval(timer); timer = null; }
}
