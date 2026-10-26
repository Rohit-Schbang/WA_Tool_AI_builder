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

// ---------------------------------------------------------------------------
// Explorer: a contact's conversations across all chatbots.
//
// The Contacts Explorer screen is organised around a Contact, but the runtime
// stores chat history per Conversation (chatbotId + waUserId). There is no
// "journey" entity — a chatbot (and the workflow version it runs) IS the
// journey here. We join Conversation.waUserId to the contact's phone to list
// every conversation that contact has had, grouped so the UI can offer a
// "Journey" (= chatbot) switcher.
//
// Phone/waUserId formats can differ (a stored contact may be "+91 99677 22208"
// while WhatsApp sends "919967722208"), so we match on a digits-only key and
// also try the exact value.
// ---------------------------------------------------------------------------

// Reduce a phone/waId to just its digits for tolerant matching.
function digitsOnly(value: string): string {
    return String(value ?? "").replace(/\D/g, "");
}

// Resolve a human-friendly node label from a workflow definition JSON, given a
// node id. Falls back to the id itself (or null) when it can't be found. The
// definition shape is { nodes: [{ id, nodeType, seq, config:{ name } }], ... }.
function nodeLabelFromDefinition(definition: unknown, nodeId: string | null): string | null {
    if (!nodeId) return null;
    const def = definition as { nodes?: Array<Record<string, any>> } | null;
    const nodes = Array.isArray(def?.nodes) ? def!.nodes : [];
    const node = nodes.find((n) => n?.id === nodeId);
    if (!node) return nodeId;
    const name = String(node?.config?.name ?? "").trim();
    if (name) return name;
    const type = String(node?.nodeType ?? "node");
    return node?.seq != null ? `${type} ${node.seq}` : type;
}

export interface ContactConversationSummary {
    id: string;
    chatbotId: string;
    chatbotName: string;
    status: string;
    currentNodeId: string | null;
    currentNodeLabel: string | null;
    variables: unknown;
    messageCount: number;
    createdAt: Date;
    lastMessageAt: Date | null;
    messages: Array<{
        id: string;
        direction: string;
        messageType: string;
        content: unknown;
        status: string | null;
        createdAt: Date;
    }>;
}

// Returns null when the contact doesn't exist; otherwise the contact plus an
// array of its conversations (newest activity first), each with its full
// message history and the chatbot ("journey") it belongs to.
export async function getContactConversations(
    contactId: string
): Promise<{ contact: { id: string; name: string; phone: string; tags: string[]; notes: string | null }; conversations: ContactConversationSummary[] } | null> {
    const contact = await prisma.contact.findUnique({ where: { id: contactId } });
    if (!contact) return null;

    const phoneDigits = digitsOnly(contact.phone);

    // Match on exact waUserId or the digits-only form. We fetch a candidate set
    // by exact + "contains digits" is not possible on a formatted column, so we
    // pull conversations whose waUserId equals the raw phone or its digits, then
    // also filter in JS on the digits key to catch any formatting differences.
    const candidates = await prisma.conversation.findMany({
        where: {
            OR: [
                { waUserId: contact.phone },
                { waUserId: phoneDigits },
            ],
        },
        orderBy: { updatedAt: "desc" },
        include: {
            chatbot: { select: { id: true, name: true } },
            workflowVersion: { select: { definition: true } },
            messages: { orderBy: { createdAt: "asc" } },
        },
    });

    // Defensive second pass: in case neither exact form matched but a
    // differently-formatted waUserId shares the same digits, scan broadly only
    // when the targeted query found nothing (keeps the common path cheap).
    let rows = candidates;
    if (rows.length === 0 && phoneDigits) {
        const all = await prisma.conversation.findMany({
            orderBy: { updatedAt: "desc" },
            include: {
                chatbot: { select: { id: true, name: true } },
                workflowVersion: { select: { definition: true } },
                messages: { orderBy: { createdAt: "asc" } },
            },
        });
        rows = all.filter((c) => digitsOnly(c.waUserId) === phoneDigits);
    }

    const conversations: ContactConversationSummary[] = rows.map((c) => ({
        id: c.id,
        chatbotId: c.chatbotId,
        chatbotName: c.chatbot?.name ?? "Unknown bot",
        status: c.status,
        currentNodeId: c.currentNodeId,
        currentNodeLabel: nodeLabelFromDefinition(c.workflowVersion?.definition ?? null, c.currentNodeId),
        variables: c.variables,
        messageCount: c.messages.length,
        createdAt: c.createdAt,
        lastMessageAt: c.lastMessageAt,
        messages: c.messages.map((m) => ({
            id: m.id,
            direction: m.direction,
            messageType: m.messageType,
            content: m.content,
            status: m.status,
            createdAt: m.createdAt,
        })),
    }));

    return {
        contact: {
            id: contact.id,
            name: contact.name,
            phone: contact.phone,
            tags: contact.tags,
            notes: contact.notes,
        },
        conversations,
    };
}
