"use client"

import { api } from "@/lib/api";
import { clearToken, getToken } from "@/lib/auth";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

// Shape of a Contact returned by the backend
interface Contact {
    id: string;
    name: string;
    phone: string;
    tags: string[];
    notes: string | null;
    createdAt: string;
}

export default function ContactsPage() {

    const router = useRouter()

    const [contacts, setContacts] = useState<Contact[]>([])
    const [isLoading, setIsLoading] = useState(true)
    const [error, setError] = useState("")

    // Create form fields
    const [name, setName] = useState("")
    const [phone, setPhone] = useState("")
    const [tags, setTags] = useState("")
    const [notes, setNotes] = useState("")
    const [formError, setFormError] = useState("")

    // ------------------->>> Getting all contacts

    async function loadContacts() {
        try {
            const res = await api.get("/api/contacts")
            setContacts(res.data)
        } catch (error) {
            setError("Failed to load contacts")
        } finally {
            setIsLoading(false)
        }
    }

    // ----------------------->>> Creating a contact

    async function handleCreate(e: React.FormEvent) {
        e.preventDefault()
        if (!name.trim() || !phone.trim()) return
        setFormError("")
        try {
            await api.post("/api/contacts", {
                name,
                phone,
                tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
                notes: notes || undefined,
            })
            setName(""); setPhone(""); setTags(""); setNotes("")
            loadContacts()
        } catch (err: any) {
            setFormError(err.response?.data?.error ?? "Failed to add contact")
        }
    }

    // ----------------------->>> Editing a contact (quick prompt-based edit)

    async function handleEdit(contact: Contact) {
        const newName = window.prompt("Name", contact.name)
        if (!newName) return
        const newPhone = window.prompt("Phone", contact.phone)
        if (!newPhone) return
        const newTags = window.prompt("Tags (comma separated)", contact.tags.join(", ")) ?? ""
        try {
            await api.patch(`/api/contacts/${contact.id}`, {
                name: newName,
                phone: newPhone,
                tags: newTags.split(",").map((t) => t.trim()).filter(Boolean),
                notes: contact.notes ?? undefined,
            })
            loadContacts()
        } catch (err: any) {
            alert(err.response?.data?.error ?? "Failed to update contact")
        }
    }

    // ----------------------->>> Deleting a contact

    async function handleDelete(id: string) {
        if (!window.confirm("Delete this contact?")) return;
        await api.delete(`/api/contacts/${id}`);
        loadContacts();
    }

    function handleLogout() {
        clearToken();
        router.push("/login");
    }

    useEffect(() => {
        if (!getToken()) {
            router.push("/login")
            return;
        }
        loadContacts()
    }, [])

    return (
        <div className="min-h-screen">
            <nav className="navbar bg-base-100 border-b border-base-300 px-6 sticky top-0 z-10">
                <div className="flex-1">
                    <Link href="/" className="text-lg font-bold flex items-center gap-2">
                        <span className="text-xl">💬</span> WA AI Tool
                    </Link>
                </div>
                <Link href="/chatbots" className="btn btn-ghost btn-sm">Chatbots</Link>
                <button onClick={handleLogout} className="btn btn-ghost btn-sm">Log out</button>
            </nav>

            <main className="max-w-4xl mx-auto p-6">
                <div className="flex items-end justify-between mb-6">
                    <div>
                        <h1 className="text-2xl font-bold">Contacts</h1>
                        <p className="text-base-content/60 text-sm">Your contact list — the foundation for future campaigns.</p>
                    </div>
                </div>

                {/* Create form */}
                <form onSubmit={handleCreate} className="card bg-base-100 shadow-sm mb-6">
                    <div className="card-body gap-3">
                        <div className="grid gap-3 md:grid-cols-2">
                            <input
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                placeholder="Name"
                                className="input input-bordered"
                            />
                            <input
                                value={phone}
                                onChange={(e) => setPhone(e.target.value)}
                                placeholder="Phone (e.g. +919876543210)"
                                className="input input-bordered"
                            />
                            <input
                                value={tags}
                                onChange={(e) => setTags(e.target.value)}
                                placeholder="Tags, comma separated (e.g. lead, vip)"
                                className="input input-bordered"
                            />
                            <input
                                value={notes}
                                onChange={(e) => setNotes(e.target.value)}
                                placeholder="Notes (optional)"
                                className="input input-bordered"
                            />
                        </div>
                        {formError && <div className="text-error text-sm">{formError}</div>}
                        <button type="submit" className="btn btn-primary self-start">Add contact</button>
                    </div>
                </form>

                {error && <div className="alert alert-error mb-4">{error}</div>}

                {isLoading ? (
                    <div className="flex justify-center py-16"><span className="loading loading-spinner loading-lg text-primary"></span></div>
                ) : contacts.length === 0 ? (
                    <div className="card bg-base-100 shadow-sm">
                        <div className="card-body items-center text-center py-16">
                            <div className="text-4xl mb-2">📇</div>
                            <h3 className="font-semibold">No contacts yet</h3>
                            <p className="text-base-content/60">Add your first one using the form above.</p>
                        </div>
                    </div>
                ) : (
                    <div className="grid gap-3">
                        {contacts.map((contact) => (
                            <div key={contact.id} className="card bg-base-100 shadow-sm hover:shadow-md transition-shadow">
                                <div className="card-body py-3">
                                    <div className="flex items-start justify-between gap-2">
                                        <div>
                                            <h3 className="font-semibold">{contact.name}</h3>
                                            <p className="text-sm text-base-content/60">{contact.phone}</p>
                                            {contact.notes && <p className="text-sm text-base-content/50 mt-1">{contact.notes}</p>}
                                            {contact.tags.length > 0 && (
                                                <div className="flex gap-1 mt-2 flex-wrap">
                                                    {contact.tags.map((tag) => (
                                                        <span key={tag} className="badge badge-outline badge-sm">{tag}</span>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                        <div className="flex gap-1 shrink-0">
                                            <button onClick={() => handleEdit(contact)} className="btn btn-sm btn-ghost">Edit</button>
                                            <button onClick={() => handleDelete(contact.id)} className="btn btn-sm btn-ghost text-error">Delete</button>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </main>
        </div>
    );
}
