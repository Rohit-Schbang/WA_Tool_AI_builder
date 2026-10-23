

// Handle an inboud message for a chatbot from a Whatsapp user.
// This is the main entry point the webhook calls.

import { prisma } from "../../infra/prisma.js";
import { runEngine, RunResult } from "../runtime/engine.js";
import { MessagingAdapter, WorkflowDefinition, ExecutionContext, WorkflowNode, InboundType, InboundMedia } from "../runtime/types.js";
import { LoggingAdapter } from "../messaging/loggingAdapters.js";
import { storeInboundMedia } from "../messaging/mediaStore.js";
import { ensureContactForWaUser, syncContactFromCustomerVars } from "../contacts/service.js";
import { seedCustomerVars, contactPatchFromVars, CUSTOMER_NAME } from "../runtime/customerVars.js";
import { matchesStartNode } from "../triggers/keywords.js";

// The web tester talks to the engine as "web-test" or "web-test-<session>"
// (see testPanel.tsx startOver). Those aren't real WhatsApp numbers, so we never
// create or sync a Contact for them.
const isTestUser = (waUserId: string) => waUserId === "web-test" || waUserId.startsWith("web-test-");

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
// No keywords configured => always trigger (backward compatible). Uses the
// shared keyword rules (case/space/trailing-punctuation insensitive).
function matchesTrigger(startNode: WorkflowNode | undefined, text: string): boolean {
    return matchesStartNode(startNode?.config, text);
}

export async function handleInboundMessage(
    chatbotId: string,
    waUserId: string,
    text: string,
    messaging: MessagingAdapter,
    // The web-based tester passes { bypassTrigger: true } so clicking "Test"
    // always starts the flow, regardless of the START node's trigger keywords.
    // The live WhatsApp webhook path omits this, so trigger matching still
    // applies there exactly as before.
    // The web tester also passes { useDraft: true } so it runs the latest saved
    // draft (what the user sees on the canvas) instead of the last published
    // version, and works even when the bot isn't active yet.
    // `inbound` carries the message TYPE + media/location payload so a Question
    // node can expect a specific input type (image/audio/document/…). It's
    // optional: callers that only have text (e.g. the web tester) omit it and
    // the message is treated as plain text, exactly as before.
    // `profileName` is the WhatsApp display name from the webhook (if any); used
    // to name a freshly auto-created Contact. Omitted by the web tester.
    // `simulateDelays` (web tester only): Delay blocks don't sleep on the server;
    // they're returned as markers so the test chat replays the pause.
    // `forceRestart` (webhook router): the message is this journey's trigger
    // keyword sent while the user was in a different journey on the same
    // number — start this journey from the beginning.
    opts: { bypassTrigger?: boolean; useDraft?: boolean; simulateDelays?: boolean; forceRestart?: boolean; profileName?: string | null; inbound?: { type: InboundType; media?: InboundMedia | null } } = {}
): Promise<{ status: string }> {


    // 1.  Load the chatbot & the workflow version to run.
    const chatbot = await prisma.chatbot.findUnique({ where: { id: chatbotId } })
    if (!chatbot) return { status: "chatbot_inactive" }

    let version;
    if (opts.useDraft) {
        // Draft is stored as version 0 (see workflows/service.ts).
        version = await prisma.workflowVersion.findUnique({
            where: { chatbotId_version: { chatbotId, version: 0 } }
        })
        if (!version) return { status: "no_draft" }
    } else {
        // Live path: only an active chatbot with a published version replies.
        if (!chatbot.isActive || !chatbot.activeVersionId) {
            return { status: "chatbot_inactive" }
        }
        version = await prisma.workflowVersion.findUnique({
            where: { id: chatbot.activeVersionId }
        })
        if (!version) return { status: "no_published_version" }
    }

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
        if (!opts.bypassTrigger && !matchesTrigger(startNode, text)) {
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

        // A real WhatsApp user has started a journey -> make sure they appear in
        // Contacts (global, deduped by phone). Best-effort: never block or fail
        // the conversation if this doesn't work. Skips the web tester.
        if (!isTestUser(waUserId)) {
            try {
                const contact = await ensureContactForWaUser(chatbot.ownerId, waUserId, opts.profileName);
                // Seed customer_name from the best known source (contact name or
                // the profile name) so the journey can greet/use it immediately.
                const seededVars = conversation.variables as Record<string, any>;
                seedCustomerVars(seededVars, { phone: waUserId, name: contact?.name ?? opts.profileName });
                conversation = await prisma.conversation.update({
                    where: { id: conversation.id },
                    data: { variables: seededVars },
                });
            } catch (err) {
                console.error("Auto-create contact failed:", err);
            }
        }
    }

    // A finished (or failed) journey restarts when the user sends the trigger
    // keyword again (e.g. "Hi"): same conversation row, so the message history
    // is kept, but a fresh run from START on the current live version with
    // fresh variables. Any other message after the end is ignored as before.
    // `forceRestart`: the router matched this journey's trigger keyword while
    // the user was in ANOTHER journey on the same number, so start this one
    // fresh even if an old, unfinished run of it was still waiting.
    if (conversation.status === "COMPLETED" || conversation.status === "FAILED" || opts.forceRestart) {
        const startNode = definition.nodes.find((node) => node.nodeType === "START");
        if (!opts.bypassTrigger && !opts.forceRestart && !matchesTrigger(startNode, text)) {
            return { status: "conversation_completed" }
        }
        conversation = await prisma.conversation.update({
            where: { id: conversation.id },
            data: {
                status: "ACTIVE",
                currentNodeId: null,
                workflowVersionId: version.id,
                variables: seedVariableDefaults(definition),
            },
        })
    }

       // 3. Build the execution context from saved state.
    const variables = (conversation.variables as Record<string, any>) ?? {};

    // Reserved customer variables are always available: phone is the identity
    // (authoritative), name is filled from the profile name when not already
    // set by the journey. Applies to every run (new or resumed).
    seedCustomerVars(variables, { phone: waUserId, name: opts.profileName });

    // The user replied, so clear any no-reply fallback "fired" flags — if the
    // flow waits again at any node later, its fallback should be eligible anew.
    for (const key of Object.keys(variables)) {
        if (key.startsWith("__fallbackFired_")) delete variables[key];
    }

    // Remember the name we START with, so we only write back to the Contact
    // when the journey actually changed it during this run.
    const nameBeforeRun = variables[CUSTOMER_NAME];

    // Wrap the messaging adapter so every outbound message is logged.
    const loggingMessaging = new LoggingAdapter(messaging, conversation.id);

    // #1 — build a name->config map from the workflow's global API configs.
    const apiConfigs: Record<string, any> = {};
    for (const c of (definition as any).apiConfigs ?? []) {
        if (c?.name) apiConfigs[c.name] = c;
    }

    const inboundType: InboundType = opts.inbound?.type ?? "text";
    let inboundMedia: InboundMedia | null = opts.inbound?.media ?? null;

    // Persist any inbound file (photo/video/document/audio) to durable storage
    // before the engine runs, so a Question that captures media gets a lasting
    // URL rather than a Meta media id that expires. Best-effort: on any failure
    // we keep the original metadata so the answer is never dropped.
    if (inboundMedia?.id && ["image", "video", "audio", "document"].includes(inboundType)) {
        const conn = await prisma.connection.findUnique({ where: { chatbotId }, select: { accessToken: true } });
        if (conn?.accessToken) {
            inboundMedia = await storeInboundMedia(inboundMedia, inboundType, conn.accessToken, chatbotId);
        }
    }

    const context: ExecutionContext = {
        userId: waUserId,
        variables,
        incomingText: text,
        incomingType: inboundType,
        incomingMedia: inboundMedia,
        messaging: loggingMessaging,
        apiConfigs,
        simulateDelays: !!opts.simulateDelays,
    };

    // 4. Determine where to start.
    let startNodeId = conversation.currentNodeId;
    if (!startNodeId) {
        const startNode = definition.nodes.find((node) => node.nodeType === "START");
        if (!startNode) return { status: "no_start_node" };
        startNodeId = startNode.id;
        context.incomingText = null;
        context.incomingType = null;
        context.incomingMedia = null;
    }

    // Log the inbound message before running (record the real type + payload).
    await prisma.message.create({
        data: {
            conversationId: conversation.id,
            direction: "INBOUND",
            messageType: inboundType,
            content: (inboundMedia ? { text, media: inboundMedia } : { text }) as any,
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

    // 6b. Sync the Contact from the customer variables — e.g. the journey
    // captured a fuller name ("Rohit") than Meta's profile ("R"). Debounced to a
    // single update per run and only when the name actually changed. Best-effort
    // and skipped for the web tester.
    if (!isTestUser(waUserId) && context.variables[CUSTOMER_NAME] !== nameBeforeRun) {
        const patch = contactPatchFromVars(context.variables);
        if (patch) {
            try {
                await syncContactFromCustomerVars(waUserId, patch);
            } catch (err) {
                console.error("Contact sync from customer vars failed:", err);
            }
        }
    }

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

