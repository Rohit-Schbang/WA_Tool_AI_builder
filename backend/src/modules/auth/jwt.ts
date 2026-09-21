import jwt, { SignOptions } from "jsonwebtoken"
import { config } from "../../infra/config.js"

// Interface of the  payload 
export interface TokenPayload {
    userId: string
}

// Create a token 

export function signToken(payload: TokenPayload): string {
    const options: SignOptions = {
        expiresIn: config.JWT_EXPIRES_IN as SignOptions["expiresIn"],
    }
    return jwt.sign(payload, config.JWT_SECRET, options);
}

export function verifyToken(token: string): TokenPayload {
    return jwt.verify(token, config.JWT_SECRET) as TokenPayload
}