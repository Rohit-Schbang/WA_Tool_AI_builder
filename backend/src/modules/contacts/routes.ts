import { Request, Response, Router } from "express";
import { requireAuth } from "../auth/middleware";
import z from "zod";
import { createContact, deleteContact, listContacts, updateContact, getContactConversations } from "./service";


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
    const contacts = await listContacts()
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

// GET / api/ contacts/:id/conversations  --------->>>> A contact's chat history
// across all chatbots ("journeys"). Powers the Contacts Explorer screen.
contactsRouter.get("/:id/conversations", async (req: Request, res: Response) => {
    try {
        const result = await getContactConversations(req.params.id)
        if (!result) return res.status(404).json({ error: "Contact not found" })
        return res.json(result)
    } catch (error) {
        console.error("Get Contact Conversations Error:", error)
        return res.status(500).json({ error: "Internal Server error" })
    }
})

// PATCH / api/ contacts/:id  ----------->>>> Updating a contact

contactsRouter.patch("/:id", async (req: Request, res: Response) => {

    const parsed = contactSchema.safeParse(req.body)

    if (!parsed.success) return res.status(400).json({ "error": "Invalid Input", details: parsed.error.flatten() })

    try {
        const contact = await updateContact(req.params.id, parsed.data)
        if (!contact) return res.status(404).json({ "error": "Contact not found" })
        return res.json(contact)
    } catch (error: any) {
        if (error.code === "P2002") return res.status(409).json({ error: "A contact with same phone exists" })
        console.error("Update Contact Error:", error)
        return res.status(500).json({ error: "Internal Server error" })
    }

})

// DELETE / api/ contacts/:id  ----------->>>> Deletion of contact

contactsRouter.delete("/:id", async (req: Request, res: Response) => {

    const deleted = await deleteContact(req.params.id)
    if (!deleted) return res.status(404).json({ error: "Contact not found" })
    return res.status(204).send()

})