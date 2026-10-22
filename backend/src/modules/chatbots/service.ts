import { prisma } from "../../infra/prisma.js"
import type { Prisma } from "@prisma/client"

// Chatbots are GLOBAL: any signed-in (allowed-domain) user can see and manage
// every bot. `ownerId` is kept only as "created by" for history.

// ------------------>> Creation of chatbot <<---------------------
export async function createChatbot(createdById: string, name: string) {
    return prisma.chatbot.create({
        data: { name, ownerId: createdById }
    })
}

// ------------------>> Create a chatbot from an imported journey <<----------
// The bot and its draft (version 0) are created together, so a failed import
// never leaves an empty bot behind. Nothing is published.
export async function createChatbotWithDraft(createdById: string, name: string, definition: Prisma.InputJsonValue) {
    return prisma.$transaction(async (tx) => {
        const bot = await tx.chatbot.create({ data: { name, ownerId: createdById } })
        await tx.workflowVersion.create({
            data: { chatbotId: bot.id, version: 0, status: "DRAFT", definition },
        })
        return bot
    })
}

// ------------------>> GET  all chatbots  <<---------------------
export async function listChatbots() {
    return prisma.chatbot.findMany({ orderBy: { createdAt: "desc" } })
}

// ------------->> Returns the chosen BOT (or null)  <<----------------
export async function getChatbot(id: string) {
    return prisma.chatbot.findUnique({ where: { id } })
}

// ------------------>> Rename the chatbot <<---------------------
export async function renameChatBot(id: string, name: string) {
    const result = await prisma.chatbot.updateMany({ where: { id }, data: { name } })
    if (result.count === 0) return null
    return getChatbot(id)
}

// ------------------>> ACTIVATE /DEACTIVATE the chatbot <<---------------------
export async function setChatbotActivate(id: string, isActive: boolean) {
    const result = await prisma.chatbot.updateMany({ where: { id }, data: { isActive } })
    if (result.count === 0) return null
    return getChatbot(id)
}

// ------------------>> Deletion of  chatbot <<-------------------
export async function deleteChatBot(id: string): Promise<boolean> {
    const result = await prisma.chatbot.deleteMany({ where: { id } })
    return result.count > 0
}
