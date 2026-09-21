import { prisma } from "../../infra/prisma.js"

// ------------------>> Creation of chatbot for a User <<---------------------
export async function createChatbot(ownerId: string, name: string) {

    return prisma.chatbot.create({
        data: { name, ownerId }
    })

}

// ------------------>> GET  all chatbots list  <<---------------------
export async function listChatbots(ownerId: string) {
    return prisma.chatbot.findMany(
        {
            where: {
                ownerId
            }, orderBy: {
                createdAt: "desc"
            }
        }
    )
}

// ------------->> Returns the chosen BOT  <<----------------
export async function getChatbot(ownerId: string, id: string) {
    return prisma.chatbot.findFirst({
        where: {
            id, ownerId
        }
    })
}

// ------------------>> Rename the chatbot <<---------------------
export async function renameChatBot(ownerId: string, id: string, name: string) {
    const result = await prisma.chatbot.updateMany({
        where: {
            id, ownerId
        }, data: {
            name
        }
    })

    // If no Chatbot present --> returns 'null'

    if (result.count === 0) return null
    return getChatbot(ownerId, id)
}

// ------------------>> ACTIVATE /DEACTIVATE the chatbot <<---------------------
export async function setChatbotActivate(ownerId: string, id: string, isActive: boolean) {

    const result = await prisma.chatbot.updateMany({
        where: {
            id, ownerId
        }, data: {
            isActive
        }
    })

    if (result.count === 0) return null
    return getChatbot(ownerId, id)


}

// ------------------>> Deletion of  chatbot <<-------------------
export async function deleteChatBot(ownerId: string, id: string): Promise<boolean> {

    const result = await prisma.chatbot.deleteMany({
        where: {
            ownerId, id
        }
    })
    return result.count > 0

}