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

// ---------------------------------------------------------------------------
// Versioning: list / preview / make live / restore to editor.
// ---------------------------------------------------------------------------

// Reduce a definition to its meaningful content in a stable order, so a draft
// and a published version can be compared regardless of key order/extra fields.
function normalizeDefinition(def: any): string {
    if (!def) return "";
    const nodes = (def.nodes ?? [])
        .map((n: any) => ({
            id: n.id,
            nodeType: n.nodeType,
            position: { x: Math.round(n.position?.x ?? 0), y: Math.round(n.position?.y ?? 0) },
            config: n.config ?? {},
        }))
        .sort((a: any, b: any) => String(a.id).localeCompare(String(b.id)));
    const edges = (def.edges ?? [])
        .map((e: any) => ({ source: e.source, target: e.target, sourceHandle: e.sourceHandle ?? null }))
        .sort((a: any, b: any) =>
            `${a.source}-${a.sourceHandle}-${a.target}`.localeCompare(`${b.source}-${b.sourceHandle}-${b.target}`)
        );
    return JSON.stringify({ variables: def.variables ?? [], apiConfigs: def.apiConfigs ?? [], nodes, edges });
}

export interface VersionSummary {
    id: string;
    version: number;
    publishedAt: Date | null;
    nodeCount: number;
    isLive: boolean;
}

// All published versions (newest first) + which one is live + whether the
// draft has changes that aren't published to the live version.
export async function listVersions(chatbotId: string) {
    const chatbot = await prisma.chatbot.findUnique({ where: { id: chatbotId } });
    const rows = await prisma.workflowVersion.findMany({
        where: { chatbotId, status: "PUBLISHED" },
        orderBy: { version: "desc" },
    });

    const versions: VersionSummary[] = rows.map((r) => ({
        id: r.id,
        version: r.version,
        publishedAt: r.publishedAt,
        nodeCount: Array.isArray((r.definition as any)?.nodes) ? (r.definition as any).nodes.length : 0,
        isLive: r.id === chatbot?.activeVersionId,
    }));

    const live = rows.find((r) => r.id === chatbot?.activeVersionId) ?? null;
    const draft = await getDraft(chatbotId);
    // No live version yet -> any draft content counts as unpublished.
    const hasUnpublishedChanges = draft
        ? !live || normalizeDefinition(draft.definition) !== normalizeDefinition(live.definition)
        : false;

    return {
        versions,
        liveVersion: live?.version ?? null,
        hasUnpublishedChanges,
    };
}

// One published version (with its full definition) for read-only preview.
export async function getPublishedVersion(chatbotId: string, version: number) {
    if (!Number.isInteger(version) || version < 1) return null;
    return prisma.workflowVersion.findFirst({
        where: { chatbotId, version, status: "PUBLISHED" },
    });
}

// "Make live": point the chatbot at an existing published version. Nothing is
// deleted and history is unchanged; in-flight conversations stay pinned to the
// version they started on.
export async function activateVersion(chatbotId: string, version: number) {
    const row = await getPublishedVersion(chatbotId, version);
    if (!row) return null;
    await prisma.chatbot.update({
        where: { id: chatbotId },
        data: { activeVersionId: row.id },
    });
    return row;
}

// "Restore to editor": copy a published version's definition into the draft.
// Publishing afterwards creates a new version number (history only moves forward).
export async function restoreVersionToDraft(chatbotId: string, version: number) {
    const row = await getPublishedVersion(chatbotId, version);
    if (!row) return null;
    return saveDraft(chatbotId, row.definition as Prisma.InputJsonValue);
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

