

// Handle an inboud message for a chatbot from a Whatsapp user.
// This is the main entry point the webhook calls.

import { prisma } from "../../infra/prisma.js";
import { runEngine, RunResult } from "../runtime/engine.js";
import { MessagingAdapter, WorkflowDefinition,ExecutionContext } from "../runtime/types.js";
import { LoggingAdapter } from "../messaging/loggingAdapters.js";

export async function handleInboundMessage(
    chatbotId: string,
    waUserId: string,
    text: string,
    messaging: MessagingAdapter
): Promise<{ status: string }> {


    // 1.  Load the chatbot & its active published version.
    const chatbot = await prisma.chatbot.findUnique({ where: { id: chatbotId } })

    if (!chatbot || !chatbot.isActive || !chatbot.activeVersionId) {
        return { status: "chatbot_inactive" }
    }

    const version = await prisma.workflowVersion.findUnique({
        where: { id: chatbot.activeVersionId }
    })

    if (!version) return { status: "no_published_version" }

    const definition = version.definition as unknown as WorkflowDefinition

    // 2.  Find or create the conversation for this user + chatbot.
    let conversation = await prisma.conversation.findUnique({
        where: {
            chatbotId_waUserId: {
                chatbotId, waUserId
            }
        }
    })


    // New conversation  - start from the beginning
    if (!conversation) {
        conversation = await prisma.conversation.create({
            data: {
                chatbotId,
                waUserId,
                workflowVersionId: version.id,
                status: "ACTIVE",
                variables: {}
            }
        })
    }

    // IF the conversation already completed, dont't reprocess
    if (conversation.status === "COMPLETED") {
        return { status: "conversation_completed" }
    }

       // 3. Build the execution context from saved state.
    const variables = (conversation.variables as Record<string, any>) ?? {};

    // Wrap the messaging adapter so every outbound message is logged.
    const loggingMessaging = new LoggingAdapter(messaging, conversation.id);

    const context: ExecutionContext = {
        userId: waUserId,
        variables,
        incomingText: text,
        messaging: loggingMessaging,
    };

    // 4. Determine where to start.
    let startNodeId = conversation.currentNodeId;
    if (!startNodeId) {
        const startNode = definition.nodes.find((node) => node.nodeType === "START");
        if (!startNode) return { status: "no_start_node" };
        startNodeId = startNode.id;
        context.incomingText = null;
    }

    // Log the inbound message before running.
    await prisma.message.create({
        data: {
            conversationId: conversation.id,
            direction: "INBOUND",
            messageType: "text",
            content: { text },
        },
    });

    // Start an Execution record for this run.
    const execution = await prisma.execution.create({
        data: {
            conversationId: conversation.id,
            chatbotId,
            status: "RUNNING",
            startNodeId,
        },
    });

    // 5. Run the engine.
    let result: RunResult;
    try {
        result = await runEngine(definition, startNodeId, context);
    } catch (err) {
        console.error("Engine error:", err);
        await prisma.conversation.update({
            where: { id: conversation.id },
            data: { status: "FAILED" },
        });
        await prisma.execution.update({
            where: { id: execution.id },
            data: { status: "FAILED", error: String(err), finishedAt: new Date() },
        });
        return { status: "engine_error" };
    }

    // 6. Save the result back to the conversation.
    await prisma.conversation.update({
        where: { id: conversation.id },
        data: {
            currentNodeId: result.pausedAtNodeId,
            variables: context.variables,
            status: result.status === "completed" ? "COMPLETED" : "WAITING_FOR_INPUT",
            lastMessageAt: new Date(),
        },
    });

    // Finish the Execution record.
    await prisma.execution.update({
        where: { id: execution.id },
        data: {
            status: "COMPLETED",
            endNodeId: result.pausedAtNodeId,
            finishedAt: new Date(),
        },
    });   

    return { status: result.status === "completed" ? "completed" : "waiting" };
}

