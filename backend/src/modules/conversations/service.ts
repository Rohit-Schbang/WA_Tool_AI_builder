

// Handle an inboud message for a chatbot from a Whatsapp user.
// This is the main entry point the webhook calls.

import { prisma } from "../../infra/prisma.js";
import { runEngine, RunResult } from "../runtime/engine.js";
import { MessagingAdapter, WorkflowDefinition, ExecutionContext, WorkflowNode } from "../runtime/types.js";
import { LoggingAdapter } from "../messaging/loggingAdapters.js";

// #2 — build the initial variables map from the workflow's declared variables
// and their default values. Coerces to the declared type.
function seedVariableDefaults(definition: WorkflowDefinition): Record<string, any> {
    const vars = definition.variables;
    const out: Record<string, any> = {};
    if (!Array.isArray(vars)) return out;
    for (const v of vars) {
        if (!v?.name) continue;
        const raw = v.default ?? "";
        if (v.type === "number") out[v.name] = raw === "" ? 0 : Number(raw);
        else if (v.type === "boolean") out[v.name] = String(raw) === "true";
        else out[v.name] = String(raw);
    }
    return out;
}

// #16 — decide whether an inbound message should trigger the workflow.
// If the START node defines keywords, the message must match per matchType.
// No keywords configured => always trigger (backward compatible).
function matchesTrigger(startNode: WorkflowNode | undefined, text: string): boolean {
    const cfg = startNode?.config ?? {};
    const keywords: string[] = Array.isArray(cfg.keywords) ? cfg.keywords : [];
    if (keywords.length === 0) return true;

    const matchType: string = cfg.matchType ?? "contains";
    const msg = (text ?? "").trim().toLowerCase();

    return keywords.some((kw) => {
        const k = String(kw).trim().toLowerCase();
        if (!k) return false;
        if (matchType === "exact") return msg === k;
        if (matchType === "starts_with") return msg.startsWith(k);
        return msg.includes(k); // "contains" (default)
    });
}

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


    // New conversation  - start from the beginning, but only if the inbound
    // message matches the START node's trigger keywords (#16).
    if (!conversation) {
        const startNode = definition.nodes.find((node) => node.nodeType === "START");
        if (!matchesTrigger(startNode, text)) {
            return { status: "no_trigger_match" };
        }
        // Seed declared workflow variables with their defaults (#2).
        const seeded = seedVariableDefaults(definition);
        conversation = await prisma.conversation.create({
            data: {
                chatbotId,
                waUserId,
                workflowVersionId: version.id,
                status: "ACTIVE",
                variables: seeded
            }
        })
    }

    // IF the conversation already completed, dont't reprocess
    if (conversation.status === "COMPLETED") {
        return { status: "conversation_completed" }
    }

       // 3. Build the execution context from saved state.
    const variables = (conversation.variables as Record<string, any>) ?? {};

    // The user replied, so clear any no-reply fallback "fired" flags — if the
    // flow waits again at any node later, its fallback should be eligible anew.
    for (const key of Object.keys(variables)) {
        if (key.startsWith("__fallbackFired_")) delete variables[key];
    }

    // Wrap the messaging adapter so every outbound message is logged.
    const loggingMessaging = new LoggingAdapter(messaging, conversation.id);

    // #1 — build a name->config map from the workflow's global API configs.
    const apiConfigs: Record<string, any> = {};
    for (const c of (definition as any).apiConfigs ?? []) {
        if (c?.name) apiConfigs[c.name] = c;
    }

    const context: ExecutionContext = {
        userId: waUserId,
        variables,
        incomingText: text,
        messaging: loggingMessaging,
        apiConfigs,
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

