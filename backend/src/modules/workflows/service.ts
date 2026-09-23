import { prisma } from "../../infra/prisma.js"
import type { Prisma } from "@prisma/client"
import { validateWorkflow, ValidationResult, ValidationError } from "./validator.js"
import { ExecutionContext, WorkflowDefinition } from "../runtime/types.js";
import { ConsoleAdapter } from "../messaging/adapters.js";
import { runEngine } from "../runtime/engine.js";


const DRAFT_VERSION = 0

// Result of one simulated step.
export interface TestStepResult {
    replies: { text: string; options?: { id: string; label: string }[] }[];
    variables: Record<string, any>;
    currentNodeId: string | null;
    status: "waiting" | "completed";
}


export async function getDraft(chatbotId: string) {

    return prisma.workflowVersion.findUnique({ where: { chatbotId_version: { chatbotId, version: DRAFT_VERSION } } })

}

export async function saveDraft(chatbotId: string, definition: Prisma.InputJsonValue) {

    return prisma.workflowVersion.upsert({
        where: {
            chatbotId_version: { chatbotId, version: DRAFT_VERSION }
        }, update: { definition },
        create: {
            chatbotId,
            version: DRAFT_VERSION,
            status: "DRAFT",
            definition
        }
    })

}

// Return the highest number of the version number published for a chatbot 
export async function getMaxVersion(chatbotId: string): Promise<number> {
    const latest = await prisma.workflowVersion.findFirst({
        where: { chatbotId, status: "PUBLISHED" }, orderBy: {
            version: "desc"
        }
    })
    return latest?.version ?? 0
}

// Result of publish attempt
export interface PublishResult {
    ok: boolean;
    errors?: ValidationError[];
    version?: number
}

// Run  one step of the DRAFT workflow in-memory  (no DB writes , no Whatsapp)
// Used by the builder's test panel

export async function testStep(
    chatbotId: string,
    incoming: {
        message: string | null;
        variables: Record<string, any>;
        currentNodeId: string | null;
    }
): Promise<TestStepResult | null> {

    const draft = await getDraft(chatbotId)
    if (!draft) return null;

    const defintion = draft.definition as unknown as WorkflowDefinition;
    const adapter = new ConsoleAdapter();
    const variables = { ...incoming.variables }

    // Where to start : resume at curentNodeId, or from the START on first message.
    let startNodeId = incoming.currentNodeId
    let incomingText = incoming.message

    if (!startNodeId) {
        const startNode = defintion.nodes.find((node) => node.nodeType == "START")
        if (!startNode) return null;
        startNodeId = startNode.id
        incomingText = null        // first run just te triggers the flow
    }

    const context: ExecutionContext = {
        userId: "test-user",
        variables,
        incomingText,
        messaging: adapter
    }

    const result = await runEngine(defintion, startNodeId, context)

    return {
        replies: adapter.sent.map((msg) => ({ text: msg.text, options: msg.options })),
        variables: context.variables,
        currentNodeId: result.pausedAtNodeId,
        status: result.status
    }
}

// Validate the draft, then create an inmmutable published version.

export async function publishDraft(chatbotId: string): Promise<PublishResult> {

    const draft = await getDraft(chatbotId)
    if (!draft) return { ok: false, errors: [{ message: "No draft to publish" }] }


    // The definiion is stored as JSON; cast it to the shape the validators excepts
    const definition = draft.definition as any
    const result: ValidationResult = validateWorkflow(definition)
    if (!result.valid) {
        return { ok: false, errors: result.errors }
    }

    // Next version number.
    const nextVersion = (await getMaxVersion(chatbotId)) + 1;

    // Create the immutable published version and point the chatbot at it.
    const published = await prisma.workflowVersion.create({
        data: {
            chatbotId,
            version: nextVersion,
            status: "PUBLISHED",
            definition: draft.definition ?? {},
            publishedAt: new Date(),
        },
    });

    await prisma.chatbot.update({
        where: { id: chatbotId },
        data: { activeVersionId: published.id },
    });

    return { ok: true, version: nextVersion };

}

