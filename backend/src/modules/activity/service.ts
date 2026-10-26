import type { Request } from "express";
import { prisma } from "../../infra/prisma.js";

// User activity log. Writes are fire-and-forget: a logging failure must never
// break the user's action, so errors are only printed.

export type ActivityAction =
  | "chatbot.create"
  | "chatbot.import"
  | "chatbot.rename"
  | "chatbot.activate"
  | "chatbot.deactivate"
  | "chatbot.delete"
  | "workflow.save"
  | "workflow.publish"
  | "workflow.activate_version"
  | "workflow.restore_version"
  | "workflow.ai_generate"
  | "connection.update"
  | "connection.embedded_signup"
  | "connection.disconnect";

interface LogOptions {
  chatbotId?: string;
  version?: number;
  details?: Record<string, unknown>;
}

// Draft auto-saves happen every ~30s; only record one "workflow.save" per user
// per bot per window so the log stays readable.
const SAVE_WINDOW_MS = 10 * 60 * 1000;
const lastSave = new Map<string, number>();

export function logActivity(
  req: Request,
  action: ActivityAction,
  opts: LogOptions = {},
): void {
  const userId = req.userId ?? null;

  if (action === "workflow.save" && userId && opts.chatbotId) {
    const key = `${userId}|${opts.chatbotId}`;
    const now = Date.now();
    const prev = lastSave.get(key) ?? 0;
    if (now - prev < SAVE_WINDOW_MS) return;
    lastSave.set(key, now);
  }

  void (async () => {
    try {
      const user = userId
        ? await prisma.user.findUnique({
            where: { id: userId },
            select: { email: true },
          })
        : null;
      await prisma.activityLog.create({
        data: {
          userId,
          userEmail: user?.email ?? null,
          action,
          chatbotId: opts.chatbotId ?? null,
          version: opts.version ?? null,
          details: (opts.details ?? undefined) as any,
        },
      });
    } catch (err) {
      console.error(
        "Activity log write failed:",
        (err as Error)?.message ?? err,
      );
    }
  })();
}

export async function listActivity(filter: {
  chatbotId?: string;
  limit?: number;
  before?: Date;
}) {
  const limit = Math.min(Math.max(filter.limit ?? 50, 1), 200);
  return prisma.activityLog.findMany({
    where: {
      ...(filter.chatbotId ? { chatbotId: filter.chatbotId } : {}),
      ...(filter.before ? { createdAt: { lt: filter.before } } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}
