import { prisma } from "../../infra/prisma.js"
import { hashPassword, comparePassword } from "./password.js"
import { signToken } from "./jwt.js"
import { isAllowedEmail } from "./domain.js"

interface AuthResult {
    token: string,
    user: {
        id: string,
        email: string,
        name: string | null
    }
}

function normalizeEmail(email: string): string {
    return email.trim().toLowerCase()
}

function authResult(user: { id: string; email: string; name: string | null }): AuthResult {
    return {
        token: signToken({ userId: user.id }),
        user: { id: user.id, email: user.email, name: user.name },
    }
}

export async function registerUser(
    email: string,
    name: string,
    password: string
): Promise<AuthResult> {
    email = normalizeEmail(email)

    // Organisation-only: reject non-company emails before touching the DB.
    if (!isAllowedEmail(email)) throw new Error("DOMAIN_NOT_ALLOWED")

    const existing = await prisma.user.findUnique({ where: { email } })
    if (existing) {
        throw new Error("Email taken")
    }

    const passwordHash = await hashPassword(password)
    const user = await prisma.user.create({
        data: { name, passwordHash, email }
    })

    return authResult(user)
}

export async function loginUser(email: string, password: string): Promise<AuthResult> {
    email = normalizeEmail(email)

    // Also enforced at login, so any pre-existing non-company accounts are locked out.
    if (!isAllowedEmail(email)) throw new Error("DOMAIN_NOT_ALLOWED")

    const user = await prisma.user.findUnique({ where: { email } })
    if (!user) {
        throw new Error("INVALID CREDENTIALS")
    }

    const matched = await comparePassword(password, user.passwordHash)
    if (!matched) {
        throw new Error("INVALID CREDENTIALS")
    }

    return authResult(user)
}
