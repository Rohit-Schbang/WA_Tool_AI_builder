// Trigger keywords are unique across the WORKSPACE. Every journey sends and
// receives through the one master WhatsApp number, so two journeys with the
// same keyword would make it ambiguous which one answers.
//
// Each journey RESERVES the keywords of its draft AND its live version (so a
// keyword renamed in the draft can't be taken while the live bot still answers
// to it). Inactive journeys keep their keywords too; deleting releases them.
//
// Every write that can add a keyword (draft save, version restore, "make
// live") runs through guardKeywords(): it takes a Postgres advisory lock,
// re-reads what the other journeys hold, and only then writes. Concurrent
// requests are serialised, so a duplicate can't slip in between check and save,
// whether the request came from the UI or a direct API call.
//
// Clashes that already existed (legacy data) don't block saving; only clashes a
// write would ADD are rejected. Existing ones come back as warnings.
import { Prisma } from "@prisma/client";
import { prisma } from "../../infra/prisma.js";
import { describeConflicts, findConflicts, reservedKeys, type HolderJourney, type KeywordConflict } from "./keywords.js";

export type { KeywordConflict } from "./keywords.js";

type Db = Prisma.TransactionClient | typeof prisma;

export class KeywordConflictError extends Error {
  constructor(public conflicts: KeywordConflict[]) {
    super(describeConflicts(conflicts));
    this.name = "KeywordConflictError";
  }
}

// Keys every journey holds (draft + live), in 3 queries regardless of count.
async function loadHolders(db: Db, opts: { onlyActive?: boolean } = {}): Promise<HolderJourney[]> {
  const bots = await db.chatbot.findMany({
    where: opts.onlyActive ? { isActive: true } : {},
    select: { id: true, name: true, isActive: true, activeVersionId: true },
  });
  if (!bots.length) return [];
  const drafts = await db.workflowVersion.findMany({
    where: { chatbotId: { in: bots.map((b) => b.id) }, version: 0 },
    select: { chatbotId: true, definition: true },
  });
  const liveIds = bots.map((b) => b.activeVersionId).filter((id): id is string => !!id);
  const lives = liveIds.length
    ? await db.workflowVersion.findMany({ where: { id: { in: liveIds } }, select: { id: true, definition: true } })
    : [];
  const draftBy = new Map(drafts.map((d) => [d.chatbotId, d.definition]));
  const liveBy = new Map(lives.map((v) => [v.id, v.definition]));

  return bots.map((b) => {
    const keys = new Set<string>();
    for (const def of [draftBy.get(b.id), b.activeVersionId ? liveBy.get(b.activeVersionId) : null]) {
      if (def) for (const k of reservedKeys(def)) keys.add(k);
    }
    return { chatbotId: b.id, name: b.name, isActive: b.isActive, isLive: !!b.activeVersionId, keys };
  });
}

// Keys a journey holds, with optional overrides for the write being validated.
async function keysOf(db: Db, chatbotId: string, override: { draft?: any; live?: any } = {}): Promise<Set<string>> {
  const keys = new Set<string>();
  const draft = override.draft !== undefined
    ? override.draft
    : (await db.workflowVersion.findUnique({ where: { chatbotId_version: { chatbotId, version: 0 } }, select: { definition: true } }))?.definition;
  let live = override.live;
  if (live === undefined) {
    const bot = await db.chatbot.findUnique({ where: { id: chatbotId }, select: { activeVersionId: true } });
    live = bot?.activeVersionId
      ? (await db.workflowVersion.findUnique({ where: { id: bot.activeVersionId }, select: { definition: true } }))?.definition
      : null;
  }
  for (const def of [draft, live]) if (def) for (const k of reservedKeys(def)) keys.add(k);
  return keys;
}

// One workspace-wide lock (released when the transaction ends).
async function lockWorkspace(tx: Prisma.TransactionClient) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"trigger-keywords:workspace"}))`;
}

const TX = { timeout: 20_000, maxWait: 10_000 };

// Read-only check for the editor: would these keys clash with another journey?
// `phoneNumber` is the master number (shown in the dialog), if connected.
export async function checkKeywords(chatbotId: string, keys: string[]) {
  const others = (await loadHolders(prisma)).filter((h) => h.chatbotId !== chatbotId);
  const conn = await prisma.workspaceConnection.findUnique({ where: { key: "master" }, select: { phoneNumberId: true, phoneNumber: true } });
  return {
    phoneNumberId: conn?.phoneNumberId ?? null,
    phoneNumber: conn?.phoneNumber ?? null,
    conflicts: findConflicts(new Set(keys), others),
  };
}

// Turn a journey ON safely: refuse (KeywordConflictError) if another ACTIVE
// journey shares one of its keywords (draft or live, both sides), unless
// `deactivateConflicting` is set: then those are switched off first, in the
// same locked transaction. Returns the journeys switched off.
export async function guardActivation(chatbotId: string, deactivateConflicting: boolean) {
  return prisma.$transaction(async (tx) => {
    await lockWorkspace(tx);
    const mine = await keysOf(tx, chatbotId);
    const others = (await loadHolders(tx, { onlyActive: true })).filter((h) => h.chatbotId !== chatbotId);
    const conflicts = findConflicts(mine, others);
    if (conflicts.length && !deactivateConflicting) throw new KeywordConflictError(conflicts);

    const off = [...new Map(conflicts.map((c) => [c.chatbotId, { chatbotId: c.chatbotId, name: c.name }])).values()];
    if (off.length) await tx.chatbot.updateMany({ where: { id: { in: off.map((o) => o.chatbotId) } }, data: { isActive: false } });
    await tx.chatbot.update({ where: { id: chatbotId }, data: { isActive: true } });
    return { deactivated: off, notConnected: false };
  }, TX);
}

// Run `write` only if it adds no NEW keyword clash.
//   next.draft / next.live : definitions this write will store (omit = unchanged)
// Throws KeywordConflictError (nothing written) when a new clash would appear.
export async function guardKeywords<T>(
  chatbotId: string,
  next: { draft?: any; live?: any },
  write: () => Promise<T>
): Promise<{ result: T; warnings: KeywordConflict[] }> {
  return prisma.$transaction(async (tx) => {
    await lockWorkspace(tx);
    const before = await keysOf(tx, chatbotId);
    const after = await keysOf(tx, chatbotId, next);
    const others = (await loadHolders(tx)).filter((h) => h.chatbotId !== chatbotId);
    const clashes = findConflicts(after, others);
    const fresh = clashes.filter((c) => !before.has(c.keyword));
    if (fresh.length) throw new KeywordConflictError(fresh);
    // The lock is held until this transaction commits, so `write` finishes
    // before any other keyword write can run its check.
    return { result: await write(), warnings: clashes };
  }, TX);
}
