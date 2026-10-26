import { prisma } from "../../../infra/prisma.js";
import type { WorkspaceConnection } from "@prisma/client";

// The workspace has ONE master WhatsApp (Meta) connection shared by every
// journey. It isn't linked to a chatbot, so creating / importing / deleting a
// journey never changes it. Only an admin (SETTINGS_ADMIN_EMAILS) can update
// or disconnect it via the connection routes.

export const MASTER_KEY = "master";

export type MasterConnection = WorkspaceConnection;

// Fields the frontend may see. NO accessToken, appSecret, verifyToken or App ID.
export interface SafeConnection {
    id: string;
    businessName: string | null;
    phoneNumber: string | null;
    phoneNumberId: string | null;
    wabaId: string | null;
    systemUserId: string | null;
    systemUserName: string | null;
    status: string;
    hasAccessToken: boolean;
    hasAppSecret: boolean;
    hasVerifyToken: boolean;
    updatedAt: string;
    updatedByEmail: string | null;
}

export function ToSafeConnection(c: MasterConnection): SafeConnection {
    return {
        id: c.id,
        businessName: c.businessName,
        phoneNumber: c.phoneNumber,
        phoneNumberId: c.phoneNumberId,
        wabaId: c.wabaId,
        systemUserId: c.systemUserId,
        systemUserName: c.systemUserName,
        status: c.status,
        hasAccessToken: !!c.accessToken,
        hasAppSecret: !!c.appSecret,
        hasVerifyToken: !!c.verifyToken,
        updatedAt: c.updatedAt.toISOString(),
        updatedByEmail: c.updatedByEmail,
    }
}

// The data a caller can send when saving the connection. All optional.
export interface ConnectionInput {
    businessName?: string | null;
    phoneNumber?: string | null;
    phoneNumberId?: string | null;
    wabaId?: string | null;
    systemUserId?: string | null;
    systemUserName?: string | null;
    accessToken?: string | null;
    appId?: string | null;
    appSecret?: string | null;
    verifyToken?: string | null;
    status?: "DISCONNECTED" | "CONNECTED" | "ERROR";
    updatedByEmail?: string | null;
}

// The full master row (with secrets) — callers must use ToSafeConnection
// before sending it to a client. Null if never configured.
export async function getConnection(): Promise<MasterConnection | null> {
    return prisma.workspaceConnection.findUnique({ where: { key: MASTER_KEY } })
}

// Credentials needed to send / receive, or null if not usable. Deliberately
// ignores `status`: a stored token keeps working until an admin changes it.
export async function getSendingCredentials(): Promise<{ phoneNumberId: string; accessToken: string } | null> {
    const c = await getConnection()
    if (!c?.accessToken || !c.phoneNumberId) return null
    return { phoneNumberId: c.phoneNumberId, accessToken: c.accessToken }
}

export async function upsertConnection(input: ConnectionInput): Promise<MasterConnection> {
    return prisma.workspaceConnection.upsert({
        where: { key: MASTER_KEY },
        update: { ...input },
        create: { key: MASTER_KEY, ...input },
    })
}

// Explicit admin disconnect: wipes the credentials. The ONLY code path that
// removes a working connection.
export async function disconnectConnection(adminEmail: string): Promise<MasterConnection | null> {
    const existing = await getConnection()
    if (!existing) return null
    return prisma.workspaceConnection.update({
        where: { key: MASTER_KEY },
        data: {
            status: "DISCONNECTED",
            accessToken: null,
            appSecret: null,
            appId: null,
            verifyToken: null,
            systemUserId: null,
            systemUserName: null,
            qualityRating: null,
            codeVerificationStatus: null,
            nameStatus: null,
            healthCheckedAt: null,
            updatedByEmail: adminEmail,
        },
    })
}
