import { Request, Response, NextFunction } from "express";
import { verifyToken } from "./jwt";
import { error } from "console";


declare global {
    namespace Express {
        interface Request {
            userId?: string
        }
    }
}

// Protection middleware before each endpoint as a barrier to check if valid logged in user

export function requireAuth(req: Request, res: Response, next: NextFunction) {

    const header = req.headers.authorization

    if (!header) return res.status(401).json({
        error: "Missing or Invalid Authorization header"
    })

    //  Extracting the token from the Bearer 

    const token = header.slice("Bearer ".length)

    try {
        const payload = verifyToken(token)
        req.userId = payload.userId
        next()
    } catch (error) {
        res.status(401).json({
            error: "Invalid or expired token"
        })
    }

}