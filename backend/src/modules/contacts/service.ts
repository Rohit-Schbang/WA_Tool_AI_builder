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
