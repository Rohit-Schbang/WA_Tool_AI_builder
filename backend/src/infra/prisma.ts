/**
 * Single shared Prisma client instance.
 *
 * Prisma is our database toolkit. It reads prisma/schema.prisma,
 * generates a fully-typed client, and lets us write queries like
 * `prisma.user.create({ data: {...} })` with autocomplete and
 * type-checking — no hand-written SQL.
 *
 * We create ONE instance and reuse it everywhere. Creating many
 * clients would open too many database connections.
 */
import { PrismaClient } from "@prisma/client";

export const prisma = new PrismaClient();
