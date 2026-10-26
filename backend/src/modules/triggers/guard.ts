// Keyword uniqueness per WhatsApp phone number.
//
// Several journeys (chatbots) may share one phone number. Each one RESERVES the
// trigger keywords of its draft AND its live version (so a keyword renamed in
// the draft can't be taken while the live bot still answers to it). Inactive
// journeys keep their keywords too; deleting a journey releases them.
//
// Every write that can add a keyword to a number (draft save, version restore,
// "make live", saving/connecting a phone number) runs through guardKeywords():
// it takes a Postgres advisory lock for that phone number, re-reads what the
// other journeys hold, and only then writes. Two concurrent requests for the
// same number are therefore serialised, so a duplicate can't slip in between a
// check and a save — whether the request came from the UI or a direct API call.
//
// Clashes that existed BEFORE this feature (legacy data) don't block saving a
// journey; only clashes a write would ADD are rejected. Legacy ones are
// returned as warnings so the UI can show them.

import { Prisma } from "@prisma/client";
import { prisma } from "../../infra/prisma.js";
import { ANY_MESSAGE, reservedKeys } from "./keywords.js";

type Db = Prisma.TransactionClient | typeof prisma;

export interface KeywordConflict {
  keyword: string;          // normalised key (ANY_MESSAGE for a catch-all)
  catchAll: boolean;
  chatbotId: string;        // the OTHER journey that already holds it
  name: string;
  isActive: boolean;
  isLive: boolean;          // has a published version
}

export class KeywordConflictError extends Error {
  constructor(public conflicts: KeywordConflict[]) {
    super(describeConflicts(conflicts));
    this.name = "KeywordConflictError";
  }
}

export function describeConflicts(conflicts: KeywordConflict[]): string {
  const parts = conflicts.map((c) =>
    `${c.catchAll ? "\"any message\" (no keywords)" : `"${c.keyword}"`} is already used by "${c.name}" (${c.isActive ? "Active" : "Inactive"})`
  );
  return `A journey with this trigger keyword already exists for this phone number: ${parts.join("; ")}. Choose a different keyword or manage the existing journey first.`;
}

// Keys a journey holds: its draft + its live version, unless overridden by the
// write being validated (`draft` / `live` = the definition about to be saved).
async function reservedForBot(db: Db, chatbotId: string, override: { draft?: any; live?: any } = {}): Promise<Set<string>> {
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
  // A journey with no flow yet reserves nothing (not even "any message").
  for (const def of [draft, live]) if (def) for (const k of reservedKeys(def)) keys.add(k);
  return keys;
}

// Which of `keys` are already held by OTHER journeys on this phone number.
async function conflictsOnNumber(db: Db, phoneNumberId: string, chatbotId: string, keys: Set<string>): Promise<KeywordConflict[]> {
  if (!keys.size) return [];
  const others = await db.connection.findMany({
    where: { phoneNumberId, chatbotId: { not: chatbotId } },
    select: { chatbotId: true, chatbot: { select: { name: true, isActive: true, activeVersionId: true } } },
  });
  const out: KeywordConflict[] = [];
  for (const o of others) {
    const held = await reservedForBot(db, o.chatbotId);
    for (const k of keys) {
      if (held.has(k)) {
        out.push({
          keyword: k,
          catchAll: k === ANY_MESSAGE,
          chatbotId: o.chatbotId,
          name: o.chatbot.name,
          isActive: o.chatbot.isActive,
          isLive: !!o.chatbot.activeVersionId,
        });
      }
    }
  }
  return out;
}

// Serialise keyword writes per phone number (released when the transaction ends).
async function lockNumber(tx: Prisma.TransactionClient, phoneNumberId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"trigger-keywords:" + phoneNumberId}))`;
}

// Read-only check for the editor: does adding `keywords` (or a catch-all) to
// this journey clash with another journey on its phone number?
export async function checkKeywords(chatbotId: string, keys: string[]): Promise<{ phoneNumberId: string | null; phoneNumber: string | null; conflicts: KeywordConflict[] }> {
  const conn = await prisma.connection.findUnique({ where: { chatbotId }, select: { phoneNumberId: true, phoneNumber: true } });
  if (!conn?.phoneNumberId) return { phoneNumberId: null, phoneNumber: null, conflicts: [] };
  return {
    phoneNumberId: conn.phoneNumberId,
    phoneNumber: conn.phoneNumber,
    conflicts: await conflictsOnNumber(prisma, conn.phoneNumberId, chatbotId, new Set(keys)),
  };
}

// Trigger keywords of THIS journey (draft + published) that another ACTIVE
// journey on the same number also holds (draft + published). Drafts count on
// both sides: an active-but-unpublished journey goes live with its draft's
// keywords on its next publish, so two active journeys sharing one would make
// routing ambiguous. Activation is refused while these exist.
export async function activeClashes(db: Db, chatbotId: string): Promise<{ phoneNumberId: string | null; conflicts: KeywordConflict[] }> {
  const conn = await db.connection.findUnique({ where: { chatbotId }, select: { phoneNumberId: true } });
  if (!conn?.phoneNumberId) return { phoneNumberId: null, conflicts: [] };
  const mine = await reservedForBot(db, chatbotId);
  if (!mine.size) return { phoneNumberId: conn.phoneNumberId, conflicts: [] };

  const others = await db.connection.findMany({
    where: { phoneNumberId: conn.phoneNumberId, chatbotId: { not: chatbotId }, chatbot: { isActive: true } },
    select: { chatbotId: true, chatbot: { select: { name: true, activeVersionId: true } } },
  });
  const conflicts: KeywordConflict[] = [];
  for (const o of others) {
    const theirs = await reservedForBot(db, o.chatbotId);
    for (const k of mine) {
      if (theirs.has(k)) {
        conflicts.push({
          keyword: k,
          catchAll: k === ANY_MESSAGE,
          chatbotId: o.chatbotId,
          name: o.chatbot.name,
          isActive: true,
          isLive: !!o.chatbot.activeVersionId,
        });
      }
    }
  }
  return { phoneNumberId: conn.phoneNumberId, conflicts };
}

// Turn a journey ON safely: refuse (KeywordConflictError) if another ACTIVE
// journey on its number shares a live trigger keyword — unless
// `deactivateConflicting` is set, in which case those journeys are switched
// off first, in the same locked transaction. Returns the ids switched off.
export async function guardActivation(
  chatbotId: string,
  deactivateConflicting: boolean
): Promise<{ deactivated: { chatbotId: string; name: string }[]; notConnected: boolean }> {
  return prisma.$transaction(async (tx) => {
    const first = await activeClashes(tx, chatbotId);
    if (!first.phoneNumberId) {
      // Not on any WhatsApp number yet, so there's nothing to clash with (and
      // it can't reply either). Activated; the caller tells the user.
      await tx.chatbot.update({ where: { id: chatbotId }, data: { isActive: true } });
      return { deactivated: [], notConnected: true };
    }
    await lockNumber(tx, first.phoneNumberId);
    const { conflicts } = await activeClashes(tx, chatbotId); // re-read under the lock
    if (conflicts.length && !deactivateConflicting) throw new KeywordConflictError(conflicts);

    const off = [...new Map(conflicts.map((c) => [c.chatbotId, { chatbotId: c.chatbotId, name: c.name }])).values()];
    if (off.length) {
      await tx.chatbot.updateMany({ where: { id: { in: off.map((o) => o.chatbotId) } }, data: { isActive: false } });
    }
    await tx.chatbot.update({ where: { id: chatbotId }, data: { isActive: true } });
    return { deactivated: off, notConnected: false };
  }, { timeout: 20_000, maxWait: 10_000 });
}

// Run `write` only if it adds no NEW keyword clash on the journey's number.
//   next.draft / next.live : definitions this write will store (omit = unchanged)
//   next.phoneNumberId     : the number the journey will be on (omit = unchanged)
// Throws KeywordConflictError (nothing written) when a new clash would appear.
export async function guardKeywords<T>(
  chatbotId: string,
  next: { draft?: any; live?: any; phoneNumberId?: string | null },
  write: () => Promise<T>
): Promise<{ result: T; warnings: KeywordConflict[] }> {
  return prisma.$transaction(async (tx) => {
    const conn = await tx.connection.findUnique({ where: { chatbotId }, select: { phoneNumberId: true } });
    const oldNumber = conn?.phoneNumberId ?? null;
    const newNumber = next.phoneNumberId !== undefined ? next.phoneNumberId : oldNumber;
    if (!newNumber) return { result: await write(), warnings: [] };

    await lockNumber(tx, newNumber);
    // Keys this journey already held ON THIS NUMBER (none if it's moving here).
    const before = oldNumber === newNumber ? await reservedForBot(tx, chatbotId) : new Set<string>();
    const after = await reservedForBot(tx, chatbotId, { draft: next.draft, live: next.live });
    const clashes = await conflictsOnNumber(tx, newNumber, chatbotId, after);
    const fresh = clashes.filter((c) => !before.has(c.keyword));
    if (fresh.length) throw new KeywordConflictError(fresh);

    // The lock is held until this transaction commits, so `write` (even though
    // it uses the shared client) completes before any other keyword write for
    // this number can run its check.
    return { result: await write(), warnings: clashes };
  }, { timeout: 20_000, maxWait: 10_000 });
}
