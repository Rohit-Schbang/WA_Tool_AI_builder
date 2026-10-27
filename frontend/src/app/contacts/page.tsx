"use client"

import { api } from "@/lib/api";
import { getToken } from "@/lib/auth";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Sidebar } from "@/app/components/Sidebar";
import { TopNav } from "@/app/components/TopNav";
import { dialog } from "@/app/components/Dialog";

// Shape of a Contact returned by the backend
interface Contact {
    id: string;
    name: string;
    phone: string;
    tags: string[];
    notes: string | null;
    createdAt: string;
}

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
        // One form for all three fields instead of three browser prompts.
        const res = await dialog.prompt({
            title: "Edit contact",
            fields: [
                { name: "name", label: "Name", value: contact.name, required: true },
                { name: "phone", label: "Phone", value: contact.phone, type: "tel", required: true },
                { name: "tags", label: "Tags", value: contact.tags.join(", "), hint: "Comma separated" },
            ],
        })
        if (!res) return
        const { name: newName, phone: newPhone, tags: newTags = "" } = res
        try {
            await api.patch(`/api/contacts/${contact.id}`, {
                name: newName,
                phone: newPhone,
                tags: newTags.split(",").map((t) => t.trim()).filter(Boolean),
                notes: contact.notes ?? undefined,
            })
            loadContacts()
        } catch (err: any) {
            dialog.alert({ title: "Couldn't update contact", message: err.response?.data?.error ?? "Failed to update contact", tone: "danger" })
        }
    }

    // ----------------------->>> Deleting a contact

    async function handleDelete(id: string) {
        if (!(await dialog.confirm({ title: "Delete this contact?", message: "This can't be undone.", danger: true }))) return;
        await api.delete(`/api/contacts/${id}`);
        loadContacts();
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

    // ---------------------->>> Tag filter, sort, pagination (client-side, real data)
    const [tagFilter, setTagFilter] = useState("all")
    const [sort, setSort] = useState<"recent" | "oldest" | "name" | "phone">("recent")
    const [pageSize, setPageSize] = useState(20)
    const [page, setPage] = useState(1)

    // Every tag in use, for the filter dropdown.
    const allTags = useMemo(
        () => [...new Set(contacts.flatMap((c) => c.tags))].sort((a, b) => a.localeCompare(b)),
        [contacts]
    )
    const taggedCount = contacts.filter((c) => c.tags.length > 0).length

    const sortedContacts = useMemo(() => {
        const list = tagFilter === "all"
            ? visibleContacts
            : tagFilter === "__untagged__"
                ? visibleContacts.filter((c) => c.tags.length === 0)
                : visibleContacts.filter((c) => c.tags.includes(tagFilter))
        const time = (c: Contact) => (c.createdAt ? new Date(c.createdAt).getTime() : 0)
        return [...list].sort((a, b) =>
            sort === "name" ? a.name.localeCompare(b.name)
                : sort === "phone" ? a.phone.localeCompare(b.phone)
                    : sort === "oldest" ? time(a) - time(b)
                        : time(b) - time(a)
        )
    }, [visibleContacts, tagFilter, sort])

    const pageCount = Math.max(1, Math.ceil(sortedContacts.length / pageSize))
    const currentPage = Math.min(page, pageCount)
    const pageContacts = sortedContacts.slice((currentPage - 1) * pageSize, currentPage * pageSize)
    const firstRow = sortedContacts.length ? (currentPage - 1) * pageSize + 1 : 0
    const lastRow = Math.min(currentPage * pageSize, sortedContacts.length)
    useEffect(() => { setPage(1) }, [search, tagFilter, sort, pageSize])

    // Header checkbox selects / clears the rows on THIS page.
    const allOnPageSelected = pageContacts.length > 0 && pageContacts.every((c) => selected.has(c.id))
    function togglePage() {
        setSelected((prev) => {
            const next = new Set(prev)
            for (const c of pageContacts) allOnPageSelected ? next.delete(c.id) : next.add(c.id)
            return next
        })
    }

    // Download contacts as CSV (the selected ones, else everything filtered).
    function exportCsv(only?: Set<string>) {
        const rows = only && only.size ? sortedContacts.filter((c) => only.has(c.id)) : sortedContacts
        const cell = (v: string) => `"${String(v ?? "").replace(/"/g, '""')}"`
        const csv = [
            ["Name", "Phone", "Tags", "Notes", "Added"].map(cell).join(","),
            ...rows.map((c) => [c.name, c.phone, c.tags.join("; "), c.notes ?? "", c.createdAt ? new Date(c.createdAt).toISOString() : ""].map(cell).join(",")),
        ].join("\r\n")
        const url = URL.createObjectURL(new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" }))
        const a = document.createElement("a")
        a.href = url
        a.download = `contacts-${new Date().toISOString().slice(0, 10)}.csv`
        a.click()
        URL.revokeObjectURL(url)
    }

    const btnSecondary = "inline-flex items-center gap-2 px-3.5 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 hover:border-slate-300 shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 transition-all disabled:opacity-50"
    const selectCls = "bg-white dark:bg-slate-900 text-xs font-semibold text-slate-700 dark:text-slate-200 pl-3 pr-8 py-2 border border-slate-200 dark:border-slate-700 rounded-lg hover:border-slate-300 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 cursor-pointer shadow-sm"

    return (
        <div className="min-h-screen bg-slate-50 dark:bg-slate-950 font-sans text-slate-800 dark:text-slate-100 antialiased">
            <Sidebar active="contacts" />

            <div className="pl-sidebar flex flex-col min-h-screen">
                <TopNav crumbs={[{ label: "Contacts & Audience" }]} />

                <main className="flex-1 px-6 py-8 space-y-6">
                    {/* ===================== Title + actions ===================== */}
                    <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
                        <div>
                            <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                                <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Contacts Directory &amp; Audience Sync</span>
                            </div>
                            <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50 tracking-tight">Contacts &amp; Audience</h1>
                            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 max-w-2xl">
                                Manage phone contacts and tags for your automated WhatsApp journeys. New WhatsApp users are added automatically.
                            </p>
                        </div>
                        <div className="flex items-center flex-wrap gap-2.5 shrink-0">
                            <Link href="/contacts/explorer" className={btnSecondary}>
                                <span className="material-symbols-outlined text-[16px] text-slate-500" aria-hidden="true">open_in_new</span>
                                Open Explorer
                            </Link>
                            <button type="button" onClick={() => exportCsv()} disabled={!sortedContacts.length} className={btnSecondary}>
                                <span className="material-symbols-outlined text-[16px] text-slate-500" aria-hidden="true">download</span>
                                Export CSV
                            </button>
                            <button
                                type="button"
                                onClick={openAddContactModal}
                                className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg shadow-sm shadow-emerald-600/30 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 transition-all"
                            >
                                <span className="material-symbols-outlined text-[16px]" aria-hidden="true">person_add</span>
                                Add Contact
                            </button>
                        </div>
                    </div>

                    {/* ===================== Stat cards (real counts) ===================== */}
                    <section className="grid grid-cols-1 md:grid-cols-3 gap-5" aria-label="Contact statistics">
                        <StatCard label="Total Contacts" value={contacts.length} note="All saved and auto-added contacts" icon="group" tone="bg-emerald-50 text-emerald-600 border-emerald-100 dark:bg-emerald-900/30 dark:border-emerald-800" />
                        <StatCard label="Last 30 Days" value={last30Days} note="New contacts added in the last 30 days" icon="calendar_today" tone="bg-cyan-50 text-cyan-600 border-cyan-100 dark:bg-cyan-900/30 dark:border-cyan-800" />
                        <StatCard
                            label="Tagged Contacts"
                            value={taggedCount}
                            badge={contacts.length ? `${Math.round((taggedCount / contacts.length) * 100)}%` : undefined}
                            note={`${allTags.length} tag${allTags.length === 1 ? "" : "s"} in use`}
                            icon="sell"
                            tone="bg-violet-50 text-violet-600 border-violet-100 dark:bg-violet-900/30 dark:border-violet-800"
                        />
                    </section>

                    {/* ===================== Search + filters ===================== */}
                    <section className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 pt-2">
                        <div className="relative flex-1 max-w-lg">
                            <span className="material-symbols-outlined pointer-events-none absolute inset-y-0 left-3 top-1 flex items-center text-[14px] text-slate-400" aria-hidden="true">search</span>
                            <label htmlFor="contact-search" className="sr-only">Search contacts</label>
                            <input
                                id="contact-search"
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                                className="w-full pl-10 pr-4 py-2 text-xs bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 border border-slate-200 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 placeholder-slate-400 shadow-sm"
                                placeholder="Search contacts by name, phone (+91...), or tag..."
                                type="text"
                            />
                        </div>
                        <div className="flex items-center gap-2.5 shrink-0 flex-wrap">
                            <label htmlFor="tag-filter" className="sr-only">Filter by tag</label>
                            <select id="tag-filter" value={tagFilter} onChange={(e) => setTagFilter(e.target.value)} className={selectCls}>
                                <option value="all">Tags: All</option>
                                <option value="__untagged__">No tags</option>
                                {allTags.map((t) => <option key={t} value={t}>{t}</option>)}
                            </select>
                            <label htmlFor="contact-sort" className="sr-only">Sort contacts</label>
                            <select id="contact-sort" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} className={selectCls}>
                                <option value="recent">Sort: Recently Added</option>
                                <option value="oldest">Sort: Oldest First</option>
                                <option value="name">Sort: Name (A-Z)</option>
                                <option value="phone">Sort: WhatsApp Number</option>
                            </select>
                        </div>
                    </section>

                    {error && (
                        <div role="alert" className="p-3 rounded-lg border border-rose-200 bg-rose-50 dark:bg-rose-950/40 dark:border-rose-900 text-rose-700 dark:text-rose-300 text-xs font-medium">{error}</div>
                    )}

                    {/* ===================== Table ===================== */}
                    <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-sm overflow-hidden">
                        {isLoading ? (
                            <div className="flex justify-center py-16" role="status" aria-label="Loading contacts">
                                <span className="w-8 h-8 rounded-full border-2 border-emerald-600 border-t-transparent animate-spin" />
                            </div>
                        ) : contacts.length === 0 ? (
                            <div className="flex flex-col items-center justify-center text-center py-16 px-6">
                                <div className="w-16 h-16 rounded-2xl bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 flex items-center justify-center mb-4" aria-hidden="true">
                                    <span className="material-symbols-outlined text-[36px]">perm_contact_calendar</span>
                                </div>
                                <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">No contacts yet</h2>
                                <p className="text-xs text-slate-500 dark:text-slate-400 max-w-md mt-1.5 mb-5">
                                    Add your first contact, or wait for someone to message your WhatsApp number. They're added automatically.
                                </p>
                                <button type="button" onClick={openAddContactModal} className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg shadow-sm">
                                    <span className="material-symbols-outlined text-[16px]" aria-hidden="true">add</span>
                                    Add First Contact
                                </button>
                            </div>
                        ) : (
                            <>
                                {/* Bulk action bar */}
                                {selected.size > 0 && (
                                    <div className="px-5 py-2.5 bg-emerald-50/70 dark:bg-emerald-900/20 border-b border-emerald-100 dark:border-emerald-900 flex items-center justify-between text-xs">
                                        <div className="flex items-center gap-3">
                                            <span className="font-bold text-emerald-700 dark:text-emerald-300">{selected.size} selected</span>
                                            <span className="h-4 w-px bg-emerald-200 dark:bg-emerald-800" aria-hidden="true" />
                                            <button type="button" onClick={() => exportCsv(selected)} className="font-semibold text-slate-700 dark:text-slate-200 hover:text-emerald-700 inline-flex items-center gap-1">
                                                <span className="material-symbols-outlined text-[16px]" aria-hidden="true">download</span> Export selected
                                            </button>
                                        </div>
                                        <button type="button" onClick={() => setSelected(new Set())} className="font-medium text-slate-500 hover:text-slate-800 dark:hover:text-slate-200">Deselect all</button>
                                    </div>
                                )}

                                <div className="overflow-x-auto">
                                    <table className="w-full text-left border-collapse">
                                        <thead>
                                            <tr className="bg-slate-50/75 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-800 text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                                                <th scope="col" className="py-3.5 pl-5 pr-3 w-10">
                                                    <input
                                                        type="checkbox"
                                                        aria-label="Select all contacts on this page"
                                                        checked={allOnPageSelected}
                                                        onChange={togglePage}
                                                        className="w-4 h-4 rounded text-emerald-600 border-slate-300 focus:ring-emerald-500 cursor-pointer"
                                                    />
                                                </th>
                                                <th scope="col" className="py-3.5 px-3">Contact</th>
                                                <th scope="col" className="py-3.5 px-4">WhatsApp Number</th>
                                                <th scope="col" className="py-3.5 px-4">Segments &amp; Tags</th>
                                                <th scope="col" className="py-3.5 px-4">Added</th>
                                                <th scope="col" className="py-3.5 pl-4 pr-5 text-right">Actions</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-sm">
                                            {pageContacts.length === 0 ? (
                                                <tr>
                                                    <td colSpan={6} className="py-12 text-center text-xs text-slate-500 dark:text-slate-400">
                                                        No contacts match your search or filters.{" "}
                                                        <button type="button" onClick={() => { setSearch(""); setTagFilter("all") }} className="font-semibold text-emerald-700 hover:underline">Reset</button>
                                                    </td>
                                                </tr>
                                            ) : (
                                                pageContacts.map((contact) => (
                                                    <tr key={contact.id} className={`transition-colors group ${selected.has(contact.id) ? "bg-emerald-50/40 dark:bg-emerald-900/10" : "hover:bg-slate-50/80 dark:hover:bg-slate-800/40"}`}>
                                                        <td className="py-4 pl-5 pr-3">
                                                            <input
                                                                type="checkbox"
                                                                aria-label={`Select ${contact.name}`}
                                                                checked={selected.has(contact.id)}
                                                                onChange={() => toggleRow(contact.id)}
                                                                className="w-4 h-4 rounded text-emerald-600 border-slate-300 focus:ring-emerald-500 cursor-pointer"
                                                            />
                                                        </td>
                                                        <td className="py-4 px-3">
                                                            <div className="flex items-center gap-3">
                                                                <div className={`w-9 h-9 rounded-full font-bold text-xs flex items-center justify-center border shrink-0 ${avatarTone(contact.id)}`} aria-hidden="true">
                                                                    {initialsOf(contact.name) || "?"}
                                                                </div>
                                                                <div className="min-w-0">
                                                                    <Link
                                                                        href={`/contacts/explorer?contact=${contact.id}`}
                                                                        className="font-semibold text-slate-900 dark:text-slate-100 group-hover:text-emerald-600 hover:underline transition-colors block truncate max-w-[16rem]"
                                                                        title="Open in Conversation Explorer"
                                                                    >
                                                                        {contact.name}
                                                                    </Link>
                                                                    {contact.notes && <span className="text-xs text-slate-400 line-clamp-1 max-w-[16rem]">{contact.notes}</span>}
                                                                </div>
                                                            </div>
                                                        </td>
                                                        <td className="py-4 px-4 whitespace-nowrap">
                                                            <div className="flex items-center gap-2">
                                                                <span className="material-symbols-outlined text-[16px] text-emerald-600" style={{ fontVariationSettings: "'FILL' 1" }} aria-hidden="true">check_circle</span>
                                                                <span className="font-mono text-xs font-medium text-slate-700 dark:text-slate-200">{contact.phone}</span>
                                                            </div>
                                                        </td>
                                                        <td className="py-4 px-4">
                                                            <div className="flex items-center gap-1.5 flex-wrap max-w-[18rem]">
                                                                {contact.tags.length > 0 ? (
                                                                    contact.tags.map((tag) => (
                                                                        <button
                                                                            key={tag}
                                                                            type="button"
                                                                            onClick={() => setTagFilter(tag)}
                                                                            title={`Show contacts tagged "${tag}"`}
                                                                            className={`px-2 py-0.5 rounded text-[11px] font-medium border ${tagTone(tag)}`}
                                                                        >
                                                                            {tag}
                                                                        </button>
                                                                    ))
                                                                ) : (
                                                                    <span className="text-xs text-slate-400">—</span>
                                                                )}
                                                            </div>
                                                        </td>
                                                        <td className="py-4 px-4 text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap font-medium">
                                                            {contact.createdAt ? new Date(contact.createdAt).toLocaleDateString() : "—"}
                                                        </td>
                                                        <td className="py-4 pl-4 pr-5 text-right whitespace-nowrap">
                                                            <div className="inline-flex items-center gap-1">
                                                                <Link
                                                                    href={`/contacts/explorer?contact=${contact.id}`}
                                                                    className="p-1.5 text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/30 rounded-md transition-colors"
                                                                    title="View conversations"
                                                                    aria-label={`View conversations with ${contact.name}`}
                                                                >
                                                                    <span className="material-symbols-outlined text-[18px]" aria-hidden="true">forum</span>
                                                                </Link>
                                                                <button type="button" onClick={() => handleEdit(contact)} className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 dark:hover:text-slate-200 rounded-md transition-colors" title="Edit contact" aria-label={`Edit ${contact.name}`}>
                                                                    <span className="material-symbols-outlined text-[18px]" aria-hidden="true">edit</span>
                                                                </button>
                                                                <button type="button" onClick={() => handleDelete(contact.id)} className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded-md transition-colors" title="Delete contact" aria-label={`Delete ${contact.name}`}>
                                                                    <span className="material-symbols-outlined text-[18px]" aria-hidden="true">delete</span>
                                                                </button>
                                                            </div>
                                                        </td>
                                                    </tr>
                                                ))
                                            )}
                                        </tbody>
                                    </table>
                                </div>

                                {/* Pagination */}
                                <div className="flex flex-col sm:flex-row items-center justify-between px-6 py-4 border-t border-slate-100 dark:border-slate-800 gap-4">
                                    <p className="text-xs text-slate-500 dark:text-slate-400 font-medium" aria-live="polite">
                                        Showing <span className="font-semibold text-slate-800 dark:text-slate-100">{firstRow}</span> to{" "}
                                        <span className="font-semibold text-slate-800 dark:text-slate-100">{lastRow}</span> of{" "}
                                        <span className="font-semibold text-slate-800 dark:text-slate-100">{sortedContacts.length.toLocaleString()}</span> contacts
                                    </p>
                                    <div className="flex items-center gap-6">
                                        <div className="flex items-center gap-2">
                                            <label htmlFor="contact-rows" className="text-xs text-slate-500 dark:text-slate-400 font-medium whitespace-nowrap">Rows per page:</label>
                                            <select
                                                id="contact-rows"
                                                value={pageSize}
                                                onChange={(e) => setPageSize(Number(e.target.value))}
                                                className="bg-slate-50 dark:bg-slate-800 text-xs font-semibold text-slate-700 dark:text-slate-200 pl-2.5 pr-7 py-1.5 border border-slate-200 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-1 focus:ring-emerald-500 cursor-pointer"
                                            >
                                                {[20, 40, 60, 100].map((n) => <option key={n} value={n}>{n}</option>)}
                                            </select>
                                        </div>
                                        <nav aria-label="Pagination" className="flex items-center gap-1.5">
                                            <button
                                                type="button"
                                                onClick={() => setPage(currentPage - 1)}
                                                disabled={currentPage <= 1}
                                                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-900 hover:bg-slate-50 disabled:text-slate-400 disabled:bg-slate-50 dark:disabled:bg-slate-800 disabled:cursor-not-allowed transition-colors"
                                            >
                                                <span className="material-symbols-outlined text-[14px]" aria-hidden="true">chevron_left</span>
                                                Previous
                                            </button>
                                            {pageList(currentPage, pageCount).map((p, i) =>
                                                p === "…" ? (
                                                    <span key={`gap-${i}`} className="w-6 text-center text-xs text-slate-400" aria-hidden="true">…</span>
                                                ) : (
                                                    <button
                                                        key={p}
                                                        type="button"
                                                        onClick={() => setPage(p)}
                                                        aria-current={p === currentPage ? "page" : undefined}
                                                        className={`w-8 h-8 rounded-lg text-xs flex items-center justify-center transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 ${
                                                            p === currentPage
                                                                ? "bg-emerald-50 dark:bg-emerald-900/30 border border-emerald-500 text-emerald-700 dark:text-emerald-300 font-bold"
                                                                : "hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 font-medium"
                                                        }`}
                                                    >
                                                        {p}
                                                    </button>
                                                )
                                            )}
                                            <button
                                                type="button"
                                                onClick={() => setPage(currentPage + 1)}
                                                disabled={currentPage >= pageCount}
                                                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-900 hover:bg-slate-50 disabled:text-slate-400 disabled:bg-slate-50 dark:disabled:bg-slate-800 disabled:cursor-not-allowed transition-colors"
                                            >
                                                Next
                                                <span className="material-symbols-outlined text-[14px]" aria-hidden="true">chevron_right</span>
                                            </button>
                                        </nav>
                                    </div>
                                </div>
                            </>
                        )}
                    </section>
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

// ---------------------------------------------------------------------------
// Presentational helpers
// ---------------------------------------------------------------------------

function hashOf(s: string) {
    let h = 0
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
    return h
}

// Stable avatar colour per contact.
const AVATAR_TONES = [
    "bg-emerald-100 text-emerald-800 border-emerald-200",
    "bg-blue-100 text-blue-800 border-blue-200",
    "bg-violet-100 text-violet-800 border-violet-200",
    "bg-amber-100 text-amber-800 border-amber-200",
    "bg-teal-100 text-teal-800 border-teal-200",
]
function avatarTone(id: string) {
    return AVATAR_TONES[hashOf(id) % AVATAR_TONES.length]
}

// Stable chip colour per tag name, so a tag looks the same on every row.
const TAG_TONES = [
    "bg-purple-50 text-purple-700 border-purple-200/60 dark:bg-purple-900/30 dark:text-purple-300 dark:border-purple-800",
    "bg-amber-50 text-amber-700 border-amber-200/60 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-800",
    "bg-blue-50 text-blue-700 border-blue-200/60 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-800",
    "bg-emerald-50 text-emerald-700 border-emerald-200/60 dark:bg-emerald-900/30 dark:text-emerald-300 dark:border-emerald-800",
    "bg-rose-50 text-rose-700 border-rose-200/60 dark:bg-rose-900/30 dark:text-rose-300 dark:border-rose-800",
    "bg-sky-50 text-sky-700 border-sky-200/60 dark:bg-sky-900/30 dark:text-sky-300 dark:border-sky-800",
    "bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700",
]
function tagTone(tag: string) {
    return TAG_TONES[hashOf(tag.toLowerCase()) % TAG_TONES.length]
}

// Page numbers with gaps: 1 … 4 5 6 … 12
function pageList(current: number, total: number): (number | "…")[] {
    if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1)
    const sorted = [...new Set([1, total, current - 1, current, current + 1].filter((p) => p >= 1 && p <= total))].sort((a, b) => a - b)
    const out: (number | "…")[] = []
    sorted.forEach((p, i) => {
        if (i && p - sorted[i - 1] > 1) out.push("…")
        out.push(p)
    })
    return out
}

function StatCard({ label, value, note, icon, tone, badge }: { label: string; value: number; note: string; icon: string; tone: string; badge?: string }) {
    return (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-sm flex items-center justify-between hover:border-slate-300 dark:hover:border-slate-700 transition-all">
            <div className="space-y-1">
                <div className="flex items-center gap-2">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">{label}</span>
                    {badge && <span className="inline-flex items-center text-[11px] font-semibold text-emerald-600 bg-emerald-50 dark:bg-emerald-900/30 px-1.5 rounded">{badge}</span>}
                </div>
                <div className="text-3xl font-extrabold text-slate-900 dark:text-slate-50 tracking-tight">{value.toLocaleString()}</div>
                <p className="text-xs text-slate-400 font-medium">{note}</p>
            </div>
            <div className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 border ${tone}`} aria-hidden="true">
                <span className="material-symbols-outlined text-[24px]">{icon}</span>
            </div>
        </div>
    )
}
