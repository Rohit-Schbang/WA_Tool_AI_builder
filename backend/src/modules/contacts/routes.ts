import { Request, Response, Router } from "express";
import { requireAuth } from "../auth/middleware";
import z from "zod";
import { createContact, deleteContact, listContacts, updateContact } from "./service";


export const contactsRouter = Router()

contactsRouter.use(requireAuth)

const contactSchema = z.object({
    name: z.string().min(4),
    phone: z.string().min(10),
    tags: z.array(z.string()).optional(),
    notes: z.string().optional(),
})

// GET  / api/ contacts  ----------->>>> All Contacts List for the User

contactsRouter.get("/", async (req: Request, res: Response) => {
    const contacts = await listContacts(req.userId!)
    return res.json(contacts)
})

// POST / api/ contacts ----------->>>> creation of contact

contactsRouter.post("/", async (req: Request, res: Response) => {

    const parse = contactSchema.safeParse(req.body)

    if (!parse.success) return res.status(400).json({ error: "Invalid input", details: parse.error.flatten() })

    try {
        const contact = await createContact(req.userId!, parse.data)
        return res.status(201).json(contact)

    } catch (error: any) {
        if (error.code === "P2002") return res.status(409).json({ error: "A contact with same phone exists" })
        console.error("Create Contact Error:", error)
        return res.status(500).json({ error: "Internal Server error" })
    }
})

// PATCH / api/ contacts/:id  ----------->>>> Updating a contact

contactsRouter.patch("/:id", async (req: Request, res: Response) => {

    const parsed = contactSchema.safeParse(req.body)

    if (!parsed.success) return res.status(400).json({ "error": "Invalid Input", details: parsed.error.flatten() })

    const contact = await updateContact(req.userId!, req.params.id, parsed.data)

    if (!contact) return res.status(404).json({ "error": "Contact not found" })
    return res.json(contact)

})

// DELETE / api/ contacts/:id  ----------->>>> Deletion of contact

contactsRouter.delete("/:id", async (req: Request, res: Response) => {

    const deleted = await deleteContact(req.userId!, req.params.id)
    if (!deleted) return res.status(404).json({ error: "Contact not found" })
    return res.status(204).send()

})