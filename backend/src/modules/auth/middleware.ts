import { Request, Response, NextFunction } from "express";
import { verifyToken } from "./jwt";
import { prisma } from "../../infra/prisma.js";
import { isAllowedEmail, domainErrorMessage } from "./domain.js";


declare global {
    namespace Express {
        interface Request {
            userId?: string
        }
    }
}

// Protection middleware before each endpoint as a barrier to check if valid logged in user.
// Also enforces organisation-only access on every request, so a still-valid
// JWT belonging to a non-company account (created before the domain rule, or
// if the allowed domains change) is rejected too.

export async function requireAuth(req: Request, res: Response, next: NextFunction) {

    const header = req.headers.authorization

    if (!header || !header.startsWith("Bearer ")) return res.status(401).json({
        error: "Missing or Invalid Authorization header"
    })

    const token = header.slice("Bearer ".length)

    let userId: string
    try {
        userId = verifyToken(token).userId
    } catch {
        return res.status(401).json({ error: "Invalid or expired token" })
    }

    try {
        const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } })
        if (!user) return res.status(401).json({ error: "Invalid or expired token" })
        // 401 (not 403) so the frontend's interceptor clears the session and
        // sends the user back to the login page.
        if (!isAllowedEmail(user.email)) return res.status(401).json({ error: domainErrorMessage })
    } catch (err) {
        return next(err)
    }

    req.userId = userId
    next()
}
