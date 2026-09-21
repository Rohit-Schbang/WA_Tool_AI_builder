import { prisma } from "../../infra/prisma.js";

export interface ContactInput {
    name: string;
    phone: string;
    tags?: string[];
    notes?: string;
}

// Contact Creation function --------------->>>>>>

export async function createContact(ownerId: string, input: ContactInput) {
    return prisma.contact.create({
        data: {
            ownerId,
            name: input.name,
            phone: input.phone,
            tags: input.tags ?? [],
            notes: input.notes,
        }
    })
}

//  List all contacts for a user ( newes first) ------------>>>>>>>>

export async function listContacts(ownerId: string) {
    return prisma.contact.findMany({
        where: {
            ownerId
        },
        orderBy: {
            createdAt: "desc"
        }
    })
}

// Update the contact the user own, returns the updated contact or null

export async function updateContact(ownerId: string, id: string, input: ContactInput) {
    const result = await prisma.contact.updateMany({
        where: { id, ownerId },
        data: {
            name: input.name,
            phone: input.phone,
            tags: input.tags ?? [],
            notes: input.notes
        }
    })

    if (result.count === 0) return null
    return prisma.contact.findFirst({ where: { id, ownerId } })
}

// DELETE --------->>>>>>>> Delete a contact for the user.

export async function deleteContact(ownerId: string, id: string): Promise<boolean> {
    const result = await prisma.contact.deleteMany({
        where: { id, ownerId }
    })

    return result.count > 0
}