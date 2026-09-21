
import { Router, Request, Response } from "express";
import { z } from "zod"
import { registerUser, loginUser } from "./service.js";
import { requireAuth } from "./middleware.js";

export const authRouter = Router();

authRouter.get("/ping", (_req, res) => {
  res.json({ module: "auth", status: "ok" });
});

const registerSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1),
  password: z.string().min(6)
})

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6)
})


authRouter.post("/register", async (req: Request, res: Response) => {

  // Step 1 -------> Validate the data

  const parsed = registerSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({
      error: "Invalid Inputs", details: parsed.error.flatten()
    })
  }

  const { email, name, password } = parsed.data

  // Step 2 -------> Call the service

  try {
    const result = await registerUser(email, name, password)
    return res.status(201).json(result)
  } catch (error) {
    if (error instanceof Error && error.message == "Email taken") {
      return res.status(409).json({ error: "Email already registered" })
    }
    console.log("Register error", error)
    return res.status(500).json({ error: "Internal Sever Error" })
  }

})

authRouter.post("/login", async (req: Request, res: Response) => {

  const parsed = loginSchema.safeParse(req.body)

  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid Input", details: parsed.error.flatten() })
  }

  const { email, password } = parsed.data

  try {
    const result = await loginUser(email, password)
    return res.status(200).json(result)
  } catch (error) {
    if (error instanceof Error && error.message == "INVALID CREDENTIALS") {
      return res.status(401).json({ error: "Invalid Email or Password" })
    }
    console.log("Login Error: ", error)
    return res.status(500).json({ error: "Internal Server Error" })
  }


})

