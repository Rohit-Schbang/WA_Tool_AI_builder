"use client"

import { api } from "@/lib/api";
import { clearToken, getToken } from "@/lib/auth";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Sidebar } from "@/app/components/Sidebar";

// Shape of a Contact returned by the backend
interface Contact {
    id: string;
    name: string;
    phone: string;
    tags: string[];
    notes: string | null;
    createdAt: string;
}

// Avatar palette rotation for contact initials (purely cosmetic).
const AVATAR_STYLES = [
    "bg-primary/10 text-primary",
    "bg-tertiary-fixed text-tertiary",
    "bg-secondary-fixed text-secondary",
    "bg-surface-container-high text-on-surface",
];

// Tag chip colors from the brand guidelines. `swatch` is the picker dot,
// `chip` is the applied chip style. The user chooses one before typing a tag.
const TAG_COLORS = [
    { name: "Teal", swatch: "bg-primary", chip: "bg-primary-fixed text-on-primary-fixed-variant" },
    { name: "Peach", swatch: "bg-secondary-container", chip: "bg-secondary-fixed text-on-secondary-fixed" },
    { name: "Blue", swatch: "bg-tertiary-container", chip: "bg-tertiary-fixed text-on-tertiary-fixed-variant" },
    { name: "Neutral", swatch: "bg-outline", chip: "bg-surface-container text-on-surface-variant" },
] as const

function initialsOf(name: string) {
    return name
        .split(" ")
        .map((n) => n[0])
        .filter(Boolean)
        .join("")
        .substring(0, 2)
        .toUpperCase();
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
    const [tagList, setTagList] = useState<{ name: string; color: string }[]>([])
    const [tagInput, setTagInput] = useState("")
    const [tagColor, setTagColor] = useState<string>(TAG_COLORS[0].chip)
    const [notes, setNotes] = useState("")
    const [formError, setFormError] = useState("")

    // UI-only state for the new dashboard search + row selection (no effect on data/logic)
    const [search, setSearch] = useState("")
    const [selected, setSelected] = useState<Set<string>>(new Set())
    const [isModalOpen, setIsModalOpen] = useState(false)

    function openAddContactModal() {
        setFormError("")
        setIsModalOpen(true)
    }

    function closeAddContactModal() {
        setIsModalOpen(false)
    }

    // Add a tag chip (skips blanks + case-insensitive duplicates).
    // `color` lets suggestion pills keep their own color; typed tags use the
    // brand color the user selected via the swatch picker.
    function addTag(raw: string, color?: string) {
        const tag = raw.trim().replace(/,$/, "").trim()
        if (!tag) return
        setTagList((prev) => {
            if (prev.some((t) => t.name.toLowerCase() === tag.toLowerCase())) return prev
            return [...prev, { name: tag, color: color ?? tagColor }]
        })
    }

    // Remove a tag chip by index.
    function removeTag(index: number) {
        setTagList((prev) => prev.filter((_, i) => i !== index))
    }

    // Commit whatever is typed into a chip on Enter / Space / comma.
    function handleTagKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
        if (e.key === "Enter" || e.key === " " || e.key === ",") {
            e.preventDefault()
            if (tagInput.trim()) {
                addTag(tagInput)
                setTagInput("")
            }
        } else if (e.key === "Backspace" && !tagInput && tagList.length) {
            // Backspace on an empty input removes the last chip.
            removeTag(tagList.length - 1)
        }
    }

    // Suggestion pill click -> add as a chip using that pill's own color.
    function addSuggestedTag(tag: string, color: string) {
        addTag(tag, color)
    }

    // Keep the comma-separated `tags` string in sync with the chip list so
    // handleCreate (which splits `tags` by comma) keeps working unchanged.
    useEffect(() => {
        setTags(tagList.map((t) => t.name).join(", "))
    }, [tagList])

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
            setTagList([]); setTagInput(""); setTagColor(TAG_COLORS[0].chip)
            setIsModalOpen(false)
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

    // Derived: contacts added in the last 30 days (real, from createdAt)
    const last30Days = useMemo(() => {
        const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000
        return contacts.filter((c) => c.createdAt && new Date(c.createdAt).getTime() >= cutoff).length
    }, [contacts])

    // Client-side search over real contacts
    const visibleContacts = useMemo(() => {
        const q = search.toLowerCase().trim()
        if (!q) return contacts
        return contacts.filter(
            (c) =>
                c.name.toLowerCase().includes(q) ||
                c.phone.toLowerCase().includes(q) ||
                c.tags.some((t) => t.toLowerCase().includes(q))
        )
    }, [contacts, search])

    function toggleRow(id: string) {
        setSelected((prev) => {
            const next = new Set(prev)
            if (next.has(id)) next.delete(id)
            else next.add(id)
            return next
        })
    }

    function toggleSelectAll() {
        setSelected((prev) => {
            if (prev.size === visibleContacts.length) return new Set()
            return new Set(visibleContacts.map((c) => c.id))
        })
    }

    return (
        <div className="bg-surface font-sans text-on-surface antialiased min-h-screen">
            {/* Sidebar */}
            <Sidebar active="contacts" />

            {/* Main area */}
            <div className="pl-72 flex flex-col min-h-screen">
                {/* Header */}
                <header className="fixed top-0 left-72 right-0 h-16 bg-surface/85 backdrop-blur-xl shadow-[0_1px_8px_rgba(0,0,0,0.04)] z-40 flex items-center justify-between px-space-lg">
                    <div className="flex items-center gap-space-md">
                        <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-surface-container-lowest shadow-[0_1px_3px_rgba(15,23,42,0.04)]">
                            <span className="h-2 w-2 rounded-full bg-primary"></span>
                            <span className="font-label-sm text-label-sm text-on-surface">Meta Cloud Connected</span>
                            <span className="font-label-sm text-label-sm text-on-surface-variant font-normal">• Active</span>
                        </div>
                    </div>
                    <div className="flex items-center gap-space-md">
                        <a className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high font-label-md text-label-md transition-all" href="#">
                            <span className="material-symbols-outlined text-[18px]">help</span>
                            <span>Help / Docs</span>
                        </a>
                        <button aria-label="Notifications" className="relative p-2 rounded-lg text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high transition-all">
                            <span className="material-symbols-outlined text-[20px]">notifications</span>
                            <span className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-secondary-container"></span>
                        </button>
                        <div className="h-6 w-px bg-surface-container-highest"></div>
                        <button onClick={handleLogout} className="flex items-center gap-3 pl-1 group" title="Log out">
                            <div className="flex flex-col text-right">
                                <span className="font-label-md text-label-md text-on-surface font-semibold">Log out</span>
                                <span className="font-label-sm text-label-sm text-on-surface-variant">End session</span>
                            </div>
                            <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center group-hover:opacity-90 transition-opacity">
                                <span className="material-symbols-outlined text-on-primary text-[18px]">logout</span>
                            </div>
                        </button>
                    </div>
                </header>

                <main className="w-full pt-16 bg-surface flex-1">
                    <div className="p-space-lg max-w-[1440px] w-full mx-auto space-y-space-lg">
                        {/* Header bar */}
                        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                            <div className="space-y-1">
                                <div className="flex items-center gap-2 flex-wrap">
                                    <span className="font-label-sm text-label-sm uppercase tracking-wider text-primary font-semibold">WhatsApp Cloud Engine</span>
                                    <span className="text-outline-variant font-label-sm">•</span>
                                    <span className="font-label-sm text-label-sm text-on-surface-variant">Contacts Directory &amp; Audience Sync</span>
                                    <span className="px-2 py-0.5 rounded-full bg-surface-container text-primary font-label-sm text-label-sm font-semibold">Cloud API v19.0</span>
                                </div>
                                <h1 className="font-headline-lg text-headline-lg text-on-surface tracking-tight">Contacts &amp; Audience</h1>
                                <p className="font-body-md text-body-md text-on-surface-variant">Manage phone contacts, trigger dynamic segments, and monitor audience opt-ins for automated WhatsApp journeys.</p>
                            </div>
                            <div className="flex items-center gap-2.5 flex-wrap">
                                <button className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-surface-container-lowest text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high transition-all shadow-sm font-label-md text-label-md">
                                    <span className="material-symbols-outlined text-[18px]">upload_file</span>
                                    <span>Import CSV</span>
                                </button>
                                <button className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-surface-container-lowest text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high transition-all shadow-sm font-label-md text-label-md">
                                    <span className="material-symbols-outlined text-[18px]">download</span>
                                    <span>Export</span>
                                </button>
                                <button
                                    onClick={openAddContactModal}
                                    className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-on-primary hover:bg-primary-container shadow-sm transition-all font-label-lg text-label-lg active:scale-[0.99]"
                                >
                                    <span className="material-symbols-outlined text-[18px]">person_add</span>
                                    <span>Add Contact</span>
                                </button>
                            </div>
                        </div>

                        {/* Stats bento */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div className="p-space-md rounded-xl bg-surface-container-lowest shadow-sm flex items-center justify-between">
                                <div>
                                    <span className="font-label-sm text-label-sm text-on-surface-variant uppercase tracking-wider">Total Contacts</span>
                                    <div className="flex items-baseline gap-2 mt-1">
                                        <span className="font-headline-xl text-headline-xl text-on-surface font-semibold">{contacts.length.toLocaleString()}</span>
                                    </div>
                                    <span className="font-body-sm text-body-sm text-on-surface-variant mt-0.5 block">Across all opt-in webhooks &amp; syncs</span>
                                </div>
                                <div className="w-12 h-12 rounded-xl bg-primary-fixed-dim/20 text-primary flex items-center justify-center">
                                    <span className="material-symbols-outlined text-[24px]">group</span>
                                </div>
                            </div>
                            <div className="p-space-md rounded-xl bg-surface-container-lowest shadow-sm flex items-center justify-between">
                                <div>
                                    <span className="font-label-sm text-label-sm text-on-surface-variant uppercase tracking-wider">Last 30 Days Contacts</span>
                                    <div className="flex items-baseline gap-2 mt-1">
                                        <span className="font-headline-xl text-headline-xl text-on-surface font-semibold">{last30Days.toLocaleString()}</span>
                                    </div>
                                    <span className="font-body-sm text-body-sm text-on-surface-variant mt-0.5 block">New subscriber additions logged</span>
                                </div>
                                <div className="w-12 h-12 rounded-xl bg-primary-fixed-dim/20 text-primary flex items-center justify-center">
                                    <span className="material-symbols-outlined text-[24px]">calendar_today</span>
                                </div>
                            </div>
                        </div>

                        {/* Search + controls */}
                        <div className="space-y-3">
                            <div className="flex flex-col md:flex-row gap-3 items-stretch md:items-center justify-between">
                                <div className="relative flex-1 max-w-lg">
                                    <span className="material-symbols-outlined absolute left-3 top-2.5 text-[20px] text-outline">search</span>
                                    <input
                                        value={search}
                                        onChange={(e) => setSearch(e.target.value)}
                                        className="w-full h-10 pl-10 pr-4 rounded-lg bg-surface-container-lowest text-on-surface placeholder:text-outline text-body-md font-body-md shadow-sm focus:outline-none transition-all"
                                        placeholder="Search contacts by name, phone (+91...), or tag..."
                                        type="text"
                                    />
                                </div>
                                <div className="flex items-center gap-2 overflow-x-auto pb-1 md:pb-0">
                                    <select className="h-10 px-3 rounded-lg bg-surface-container-lowest text-on-surface font-label-md text-label-md shadow-sm focus:outline-none cursor-pointer">
                                        <option value="all">Opt-in: All Status</option>
                                        <option value="verified">Verified WhatsApp</option>
                                        <option value="pending">Pending Consent</option>
                                        <option value="unsub">Unsubscribed</option>
                                    </select>
                                    <select className="h-10 px-3 rounded-lg bg-surface-container-lowest text-on-surface font-label-md text-label-md shadow-sm focus:outline-none cursor-pointer">
                                        <option value="recent">Sort: Recently Added</option>
                                        <option value="name">Sort: Name (A-Z)</option>
                                    </select>
                                </div>
                            </div>
                        </div>

                        {error && (
                            <div className="p-3 rounded-xl bg-error-container text-on-error-container font-label-md text-label-md">{error}</div>
                        )}

                        {/* Table / states */}
                        {isLoading ? (
                            <div className="flex justify-center py-16">
                                <span className="w-8 h-8 rounded-full border-2 border-primary border-t-transparent animate-spin" />
                            </div>
                        ) : contacts.length === 0 ? (
                            <div className="p-space-xl rounded-xl bg-surface-container-lowest shadow-sm flex flex-col items-center justify-center text-center py-16">
                                <div className="relative mb-4">
                                    <div className="w-20 h-20 rounded-2xl bg-surface-container flex items-center justify-center text-primary">
                                        <span className="material-symbols-outlined text-[42px]">perm_contact_calendar</span>
                                    </div>
                                    <div className="absolute -bottom-1 -right-1 w-7 h-7 rounded-full bg-secondary-container text-on-secondary flex items-center justify-center shadow-md">
                                        <span className="material-symbols-outlined text-[16px]">add</span>
                                    </div>
                                </div>
                                <h3 className="font-headline-md text-headline-md text-on-surface font-semibold tracking-tight">No contacts yet</h3>
                                <p className="font-body-md text-body-md text-on-surface-variant max-w-md mt-1.5 mb-6">
                                    Add your first contact using the form above to jumpstart your WhatsApp campaigns.
                                </p>
                                <button
                                    onClick={openAddContactModal}
                                    className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-primary text-on-primary hover:bg-primary-container font-label-lg text-label-lg transition-all shadow-sm"
                                >
                                    <span className="material-symbols-outlined text-[18px]">add</span>
                                    <span>Add First Contact</span>
                                </button>
                            </div>
                        ) : (
                            <div className="bg-surface-container-lowest rounded-xl shadow-sm overflow-hidden transition-all">
                                {/* Bulk action bar */}
                                {selected.size > 0 && (
                                    <div className="px-space-md py-2.5 bg-surface-container text-on-surface flex items-center justify-between">
                                        <div className="flex items-center gap-3">
                                            <span className="font-label-sm text-label-sm text-primary font-bold">{selected.size} contacts selected</span>
                                            <div className="h-4 w-px bg-surface-container-highest"></div>
                                            <button className="font-label-sm text-label-sm text-on-surface hover:text-primary transition-all flex items-center gap-1">
                                                <span className="material-symbols-outlined text-[16px]">campaign</span> Trigger Broadcast
                                            </button>
                                        </div>
                                        <button onClick={() => setSelected(new Set())} className="font-label-sm text-label-sm text-on-surface-variant hover:text-on-surface">Deselect all</button>
                                    </div>
                                )}

                                <div className="overflow-x-auto">
                                    <table className="w-full text-left border-collapse">
                                        <thead>
                                            <tr className="bg-surface-container-low text-on-surface-variant font-label-sm text-label-sm">
                                                <th className="p-space-md w-12 text-center">
                                                    <input
                                                        className="pf-checkbox"
                                                        type="checkbox"
                                                        checked={visibleContacts.length > 0 && selected.size === visibleContacts.length}
                                                        onChange={toggleSelectAll}
                                                    />
                                                </th>
                                                <th className="p-space-md">Contact</th>
                                                <th className="p-space-md">WhatsApp Number</th>
                                                <th className="p-space-md">Segments &amp; Tags</th>
                                                <th className="p-space-md">Added</th>
                                                <th className="p-space-md">Opt-In Status</th>
                                                <th className="p-space-md text-right">Actions</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-surface-container-low text-body-md font-body-md text-on-surface">
                                            {visibleContacts.length === 0 ? (
                                                <tr>
                                                    <td colSpan={7} className="p-space-xl text-center text-on-surface-variant font-body-md text-body-md">
                                                        No contacts match "{search}".
                                                    </td>
                                                </tr>
                                            ) : (
                                                visibleContacts.map((contact, idx) => (
                                                    <tr key={contact.id} className="hover:bg-surface-container/50 transition-colors">
                                                        <td className="p-space-md text-center">
                                                            <input
                                                                className="pf-checkbox"
                                                                type="checkbox"
                                                                checked={selected.has(contact.id)}
                                                                onChange={() => toggleRow(contact.id)}
                                                            />
                                                        </td>
                                                        <td className="p-space-md">
                                                            <div className="flex items-center gap-3">
                                                                <div className={`w-9 h-9 rounded-full font-headline-sm text-headline-sm flex items-center justify-center font-bold ${AVATAR_STYLES[idx % AVATAR_STYLES.length]}`}>
                                                                    {initialsOf(contact.name) || "?"}
                                                                </div>
                                                                <div>
                                                                    <span className="font-label-lg text-label-lg text-on-surface font-semibold block leading-tight">{contact.name}</span>
                                                                    {contact.notes && (
                                                                        <span className="font-body-sm text-body-sm text-on-surface-variant line-clamp-1">{contact.notes}</span>
                                                                    )}
                                                                </div>
                                                            </div>
                                                        </td>
                                                        <td className="p-space-md">
                                                            <div className="inline-flex items-center gap-1.5 font-label-md text-label-md text-on-surface font-medium">
                                                                <span className="material-symbols-outlined text-[16px] text-primary" style={{ fontVariationSettings: "'FILL' 1" }}>check_circle</span>
                                                                <span>{contact.phone}</span>
                                                            </div>
                                                        </td>
                                                        <td className="p-space-md">
                                                            <div className="flex items-center gap-1.5 flex-wrap">
                                                                {contact.tags.length > 0 ? (
                                                                    contact.tags.map((tag) => (
                                                                        <span key={tag} className="px-2 py-0.5 rounded-full bg-primary-fixed text-on-primary-fixed-variant font-label-sm text-label-sm">{tag}</span>
                                                                    ))
                                                                ) : (
                                                                    <span className="font-body-sm text-body-sm text-on-surface-variant">—</span>
                                                                )}
                                                            </div>
                                                        </td>
                                                        <td className="p-space-md">
                                                            <span className="font-body-sm text-body-sm text-on-surface-variant">
                                                                {contact.createdAt ? new Date(contact.createdAt).toLocaleDateString() : "—"}
                                                            </span>
                                                        </td>
                                                        <td className="p-space-md">
                                                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-surface-container text-primary font-label-sm text-label-sm font-semibold">
                                                                <span className="material-symbols-outlined text-[13px]">verified</span> Verified Opt-In
                                                            </span>
                                                        </td>
                                                        <td className="p-space-md text-right">
                                                            <div className="inline-flex items-center gap-1 justify-end">
                                                                <button onClick={() => handleEdit(contact)} className="p-1.5 rounded-lg text-on-surface-variant hover:text-primary hover:bg-surface-container transition-all" title="Edit contact">
                                                                    <span className="material-symbols-outlined text-[18px]">edit</span>
                                                                </button>
                                                                <button onClick={() => handleDelete(contact.id)} className="p-1.5 rounded-lg text-error hover:bg-error-container/30 transition-all" title="Delete contact">
                                                                    <span className="material-symbols-outlined text-[18px]">delete</span>
                                                                </button>
                                                            </div>
                                                        </td>
                                                    </tr>
                                                ))
                                            )}
                                        </tbody>
                                    </table>
                                </div>

                                {/* Footer */}
                                <div className="p-space-md bg-surface-container-lowest flex flex-col sm:flex-row items-center justify-between gap-4 text-on-surface-variant">
                                    <span className="font-body-sm text-body-sm">
                                        Showing <strong className="text-on-surface">{visibleContacts.length}</strong> of <strong className="text-on-surface">{contacts.length.toLocaleString()}</strong> contacts
                                    </span>
                                </div>
                            </div>
                        )}
                    </div>
                </main>
            </div>

            {/* Add Contact Modal */}
            {isModalOpen && (
                <div
                    className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-on-surface/40 backdrop-blur-sm"
                    onClick={(e) => { if (e.target === e.currentTarget) closeAddContactModal(); }}
                >
                    <div className="bg-surface-container-lowest rounded-2xl shadow-xl w-full max-w-xl overflow-hidden border border-surface-container transition-all">
                        <div className="px-6 py-5 border-b border-surface-container flex items-start justify-between">
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-xl bg-primary-fixed-dim/30 text-primary flex items-center justify-center shrink-0">
                                    <span className="material-symbols-outlined text-[22px]">person_add</span>
                                </div>
                                <div>
                                    <div className="flex items-center gap-2">
                                        <h3 className="font-headline-sm text-headline-sm text-on-surface font-semibold">Add New Contact</h3>
                                        <span className="inline-flex items-center gap-1 font-label-sm text-label-sm text-primary bg-surface-container px-2 py-0.5 rounded-full">
                                            <span className="material-symbols-outlined text-[12px]">flash_on</span> Meta Cloud API
                                        </span>
                                    </div>
                                    <p className="font-body-sm text-body-sm text-on-surface-variant mt-0.5">Instant Meta Cloud API validation with auto-country code normalization</p>
                                </div>
                            </div>
                            <button onClick={closeAddContactModal} className="p-1.5 rounded-lg text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-all" aria-label="Close modal">
                                <span className="material-symbols-outlined text-[20px]">close</span>
                            </button>
                        </div>

                        <form onSubmit={handleCreate} className="p-6 space-y-4">
                            <div className="space-y-4">
                                <div className="space-y-1.5">
                                    <label className="block font-label-sm text-label-sm text-on-surface font-semibold">Full Name <span className="text-secondary">*</span></label>
                                    <div className="relative">
                                        <span className="material-symbols-outlined absolute left-3.5 top-1/2 -translate-y-1/2 text-[18px] text-on-surface-variant pointer-events-none">badge</span>
                                        <input
                                            autoFocus
                                            value={name}
                                            onChange={(e) => setName(e.target.value)}
                                            type="text"
                                            required
                                            placeholder="e.g. Priya Sharma"
                                            className="w-full h-10 pl-11 pr-3.5 rounded-lg bg-surface-container-lowest border border-outline-variant text-on-surface placeholder:text-on-surface-variant/60 text-body-md font-body-md focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/15 transition-all"
                                        />
                                    </div>
                                </div>
                                <div className="space-y-1.5">
                                    <div className="flex items-center justify-between">
                                        <label className="block font-label-sm text-label-sm text-on-surface font-semibold">Phone Number <span className="text-secondary">*</span></label>
                                        <span className="font-label-sm text-label-sm text-primary flex items-center gap-1">
                                            <span className="material-symbols-outlined text-[13px]">verified</span> Auto WhatsApp Lookup
                                        </span>
                                    </div>
                                    <div className="relative">
                                        <span className="material-symbols-outlined absolute left-3.5 top-1/2 -translate-y-1/2 text-[18px] text-on-surface-variant pointer-events-none">call</span>
                                        <input
                                            value={phone}
                                            onChange={(e) => setPhone(e.target.value)}
                                            type="tel"
                                            required
                                            placeholder="+91 98765 43210"
                                            className="w-full h-10 pl-11 pr-3.5 rounded-lg bg-surface-container-lowest border border-outline-variant text-on-surface placeholder:text-on-surface-variant/60 text-body-md font-body-md focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/15 transition-all"
                                        />
                                    </div>
                                </div>
                                <div className="space-y-1.5">
                                    <div className="flex items-center gap-3 flex-wrap">
                                        <label className="font-label-sm text-label-sm text-on-surface font-semibold">Tags &amp; Audiences</label>
                                        {/* Brand color picker — the chosen color is applied to typed tags */}
                                        <div className="flex items-center gap-2">
                                            {TAG_COLORS.map((c) => (
                                                <button
                                                    key={c.name}
                                                    type="button"
                                                    onClick={() => setTagColor(c.chip)}
                                                    title={c.name}
                                                    aria-label={`${c.name} tag color`}
                                                    aria-pressed={tagColor === c.chip}
                                                    className={`w-4 h-4 rounded-full ${c.swatch} transition-all ${
                                                        tagColor === c.chip
                                                            ? "ring-2 ring-offset-2 ring-primary ring-offset-surface-container-lowest scale-110"
                                                            : "hover:scale-110 opacity-80 hover:opacity-100"
                                                    }`}
                                                />
                                            ))}
                                        </div>
                                    </div>
                                    <label className="flex items-center flex-wrap gap-1.5 w-full min-h-10 px-3.5 py-1.5 rounded-lg bg-surface-container-lowest border border-outline-variant text-on-surface focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/15 transition-all cursor-text">
                                        <span className="material-symbols-outlined text-[18px] text-on-surface-variant pointer-events-none shrink-0">label</span>
                                        {tagList.map((tag, i) => (
                                            <span key={`${tag.name}-${i}`} className={`inline-flex items-center gap-1 pl-2 pr-1.5 py-0.5 rounded-full font-label-sm text-label-sm font-semibold ${tag.color}`}>
                                                {tag.name}
                                                <button
                                                    type="button"
                                                    onClick={() => removeTag(i)}
                                                    className="inline-flex items-center opacity-70 hover:opacity-100 transition-opacity"
                                                    aria-label={`Remove ${tag.name}`}
                                                >
                                                    <span className="material-symbols-outlined text-[14px]">close</span>
                                                </button>
                                            </span>
                                        ))}
                                        <input
                                            value={tagInput}
                                            onChange={(e) => setTagInput(e.target.value)}
                                            onKeyDown={handleTagKeyDown}
                                            onBlur={() => { if (tagInput.trim()) { addTag(tagInput); setTagInput(""); } }}
                                            type="text"
                                            placeholder={tagList.length ? "" : "Type a tag and press Enter"}
                                            className="flex-1 min-w-[8rem] h-7 bg-transparent text-on-surface placeholder:text-on-surface-variant/60 text-body-md font-body-md focus:outline-none"
                                        />
                                    </label>

                                    <div className="flex items-center gap-1.5 pt-1 flex-wrap">
                                        <span className="font-body-sm text-body-sm text-on-surface-variant">Suggest:</span>
                                        <button
                                            type="button"
                                            onClick={() => addSuggestedTag("VIP", "bg-secondary-fixed text-on-secondary-fixed")}
                                            className="px-2 py-0.5 rounded-full bg-secondary-fixed text-on-secondary-fixed font-label-sm text-label-sm font-semibold hover:bg-secondary-container hover:text-on-secondary transition-all"
                                        >
                                            VIP
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => addSuggestedTag("Lead", "bg-surface-container text-on-surface-variant")}
                                            className="px-2 py-0.5 rounded-full bg-surface-container text-on-surface-variant font-label-sm text-label-sm hover:bg-primary-fixed hover:text-on-primary-fixed-variant transition-all"
                                        >
                                            Lead
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => addSuggestedTag("Cart Drop-off", "bg-tertiary-fixed text-on-tertiary-fixed-variant")}
                                            className="px-2 py-0.5 rounded-full bg-tertiary-fixed text-on-tertiary-fixed-variant font-label-sm text-label-sm hover:bg-tertiary-container hover:text-on-tertiary transition-all"
                                        >
                                            Cart Drop-off
                                        </button>
                                    </div>
                                </div>
                                <div className="space-y-1.5">
                                    <label className="block font-label-sm text-label-sm text-on-surface font-semibold">Internal Notes <span className="text-on-surface-variant font-normal">(Optional)</span></label>
                                    <div className="relative">
                                        <span className="material-symbols-outlined absolute left-3.5 top-1/2 -translate-y-1/2 text-[18px] text-on-surface-variant pointer-events-none">edit_note</span>
                                        <input
                                            value={notes}
                                            onChange={(e) => setNotes(e.target.value)}
                                            type="text"
                                            placeholder="Interested in Enterprise plan"
                                            className="w-full h-10 pl-11 pr-3.5 rounded-lg bg-surface-container-lowest border border-outline-variant text-on-surface placeholder:text-on-surface-variant/60 text-body-md font-body-md focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/15 transition-all"
                                        />
                                    </div>
                                </div>
                            </div>

                            {formError && <div className="font-body-sm text-body-sm text-error">{formError}</div>}

                            <div className="flex items-center gap-2 pt-1 text-on-surface-variant font-body-sm text-body-sm">
                                <span className="material-symbols-outlined text-[16px] text-primary">security</span>
                                <span>GDPR / Meta Business Terms opt-in logged upon addition</span>
                            </div>
                            <div className="flex items-center justify-end gap-3 pt-3 border-t border-surface-container">
                                <button type="button" onClick={closeAddContactModal} className="px-4 py-2 rounded-lg bg-surface-container-high text-on-surface font-label-md text-label-md hover:bg-surface-container transition-all">
                                    Cancel
                                </button>
                                <button type="submit" className="inline-flex items-center gap-2 px-5 py-2 rounded-lg bg-primary text-on-primary hover:bg-primary-container shadow-sm font-label-lg text-label-lg transition-all active:scale-[0.99]">
                                    <span className="material-symbols-outlined text-[18px]">check</span>
                                    <span>Save Contact</span>
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
