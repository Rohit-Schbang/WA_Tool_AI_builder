import { prisma } from "../../../infra/prisma.js";

// List conversations for a chatbot (newest activity first).
export async function listConversations(chatbotId: string) {
  return prisma.conversation.findMany({
    where: { chatbotId },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      waUserId: true,
      status: true,
      currentNodeId: true,
      variables: true,
      lastMessageAt: true,
      createdAt: true,
    },
  });
}

// Get one conversation with its full message history (oldest first).
export async function getConversationDetail(chatbotId: string, conversationId: string) {
  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, chatbotId },
    include: {
      messages: { orderBy: { createdAt: "asc" } },
    },
  });
  return conversation;
}
