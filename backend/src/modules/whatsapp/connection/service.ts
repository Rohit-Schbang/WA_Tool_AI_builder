import { prisma } from "../../../infra/prisma.js";
import type { Connection } from "@prisma/client";

//  This field allows the frontend to see. Notice: NO AccessToken, appSecret, verifyToken or App ID.
//  Those never leave backend.

export interface SafeConnection {
    id: string;
    chatbotId: string;
    businessName: string | null;
    phoneNumber: string | null;
    phoneNumberId: string | null;
    wabaId: string | null;
    status: string;
    hasAccessToken: boolean;
    hasAppSecret: boolean;
}

export function ToSafeConnection(c: Connection): SafeConnection {
    return {
        id: c.id,
        chatbotId: c.chatbotId,
        businessName: c.businessName,
        phoneNumber: c.phoneNumber,
        phoneNumberId: c.phoneNumberId,
        wabaId: c.wabaId,
        status: c.status,
        hasAccessToken: c.accessToken !== null && c.accessToken !== "",
        hasAppSecret: c.appSecret !== null && c.appSecret !== ""
    }
}


// The data a caller can send when saving a connection.
// All optional so they can update just some fields.
export interface ConnectionInput {
    businessName?: string;
    phoneNumber?: string;
    phoneNumberId?: string;
    wabaId?: string;
    accessToken?: string;
    appId?: string;
    appSecret?: string;
    verifyToken?: string;
}

// Getting raw-connection for a chatbot (may be null if never configured).
//  Return the FULL row (with secrets) - callers must use toSafeConnection
// before sending it to the client

export async function getConnection(chatbotId: string): Promise<Connection | null> {
    return prisma.connection.findUnique({ where: { chatbotId } })
}

// Create and update the connection for a chatbot (upsert)
// upsert = update if it exists, otherwise create

export async function upsertConnection(
    chatbotId: string,
    input: ConnectionInput
): Promise<Connection> {
    return prisma.connection.upsert({
        where: { chatbotId },
        update: {
            ...input
        },
        create: {
            chatbotId, ...input
        }
    })
}