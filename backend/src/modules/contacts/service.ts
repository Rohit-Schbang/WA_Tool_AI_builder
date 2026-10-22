import { prisma } from "../../infra/prisma.js";

// Contacts are GLOBAL (shared workspace). ownerId is kept as "created by".

export interface ContactInput {
    name: string;
    phone: string;
    tags?: string[];
    notes?: string;
}

export async function createContact(createdById: string, input: ContactInput) {
    return prisma.contact.create({
        data: {
            ownerId: createdById,
            name: input.name,
            phone: input.phone,
            tags: input.tags ?? [],
            notes: input.notes,
        }
    })
}

// All contacts, newest first.
export async function listContacts() {
    return prisma.contact.findMany({ orderBy: { createdAt: "desc" } })
}

// Update a contact; returns the updated contact or null if it doesn't exist.
export async function updateContact(id: string, input: ContactInput) {
    const result = await prisma.contact.updateMany({
        where: { id },
        data: {
            name: input.name,
            phone: input.phone,
            tags: input.tags ?? [],
            notes: input.notes
        }
    })
    if (result.count === 0) return null
    return prisma.contact.findUnique({ where: { id } })
}

export async function deleteContact(id: string): Promise<boolean> {
    const result = await prisma.contact.deleteMany({ where: { id } })
    return result.count > 0
}

// Ensure a contact exists for a WhatsApp user who interacted with a chatbot.
// Idempotent and non-destructive: contacts are keyed by phone (@@unique), so a
// user who messages several bots — or who was added manually — is never
// duplicated and their existing name/tags/notes are left untouched. A brand-new
// contact is created with the WhatsApp profile name (or the phone number when
// the name is unknown). `createdById` is the chatbot's owner ("created by").
// Best-effort: callers run this without blocking the conversation on failure.
export async function ensureContactForWaUser(
    createdById: string,
    phone: string,
    name?: string | null
) {
    const trimmedPhone = String(phone ?? "").trim();
    if (!trimmedPhone) return null;

    const existing = await prisma.contact.findUnique({ where: { phone: trimmedPhone } });
    if (existing) return existing;

    const displayName = String(name ?? "").trim() || trimmedPhone;
    try {
        return await prisma.contact.create({
            data: {
                ownerId: createdById,
                name: displayName,
                phone: trimmedPhone,
                tags: [],
            },
        });
    } catch {
        // A concurrent inbound could create the same phone between the check and
        // the insert (unique violation) — fetch and return the winner.
        return prisma.contact.findUnique({ where: { phone: trimmedPhone } });
    }
}

// Sync the Contact record from a journey's customer variables (e.g. the user
// gave their full name "Rohit" after Meta only provided "R"). Updates the
// Contact's name when it actually differs, so the contact list stays current.
// Idempotent and best-effort: does nothing when the contact doesn't exist or
// the name is unchanged. Returns true if a row was updated.
export async function syncContactFromCustomerVars(
    phone: string,
    patch: { name?: string }
): Promise<boolean> {
    const trimmedPhone = String(phone ?? "").trim();
    const newName = String(patch.name ?? "").trim();
    if (!trimmedPhone || !newName) return false;

    const existing = await prisma.contact.findUnique({ where: { phone: trimmedPhone } });
    if (!existing || existing.name === newName) return false;

    await prisma.contact.update({ where: { phone: trimmedPhone }, data: { name: newName } });
    return true;
}
