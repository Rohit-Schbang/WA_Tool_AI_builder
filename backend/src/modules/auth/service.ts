import { prisma } from "../../infra/prisma.js"
import { hashPassword, comparePassword } from "./password.js"
import { signToken } from "./jwt.js"

interface AuthResult {
    token: string,
    user: {
        id: string,
        email: string,
        name: string | null
    }
}

export async function registerUser(
    email: string,
    name: string,
    password: string
): Promise<AuthResult> {

    //  This checks if the user exisits with same email id in db 
    const existing = await prisma.user.findUnique({ where: { email } })
    if (existing) {
        throw new Error("Email taken")
    }

    // Create new user --> 
    // Step 1. -------->>>>> Password hashing 

    const passwordHash = await hashPassword(password)
    const user = await prisma.user.create({
        data: {
            name, passwordHash, email
        }
    })

    // Step 2. -------->>>>> Creating token for the user created

    const token = signToken({ userId: user.id })

    return {
        token, user: {
            id: user.id, email: user.email, name: user.name
        }
    }


}

// Login function 

export async function loginUser(email: string, password: string): Promise<AuthResult> {

    // Find  the User
    const user = await prisma.user.findUnique({ where: { email } })

    if (!user) {
        throw new Error("INVALID CREDENTIALS")
    }

    const matched = await comparePassword(password, user.passwordHash)
    //    If  no credentials matched
    if (!matched) {
        throw new Error("INVALID CREDENTIALS")
    }

    const token = signToken({ userId: user.id })
    return {
        token, user: {
            id: user.id,
            name: user.name,
            email: user.email
        }
    }



}