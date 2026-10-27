"use client"

import { api } from "@/lib/api";
import { getToken } from "@/lib/auth";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { Sidebar } from "@/app/components/Sidebar";
import { TopNav } from "@/app/components/TopNav";
import { EditableBotName } from "@/app/components/EditableBotName";
import { dialog } from "@/app/components/Dialog";
import { downloadJson, journeyFileName, wrapJourneyExport } from "@/lib/exportJourney";
import { ImportJourneyDialog } from "./ImportJourneyDialog";
import { ActivationConflictDialog } from "./ActivationConflictDialog";
import type { KeywordConflict } from "@/lib/keywords";



// Shape of the Chat Bot returned by the backend

interface Chatbot {
    id: string;
    name: string;
    isActive: boolean;
    createdAt: string;
    updatedAt?: string;
    activeVersionId?: string | null; // set once published
}

export default function ChatbotsPage() {

    const router = useRouter()

    // States of the BOT

    const [bots, setBots] = useState<Chatbot[]>([])
    const [isLoading, setIsLoading] = useState(true)
    const [newName, setNewName] = useState("")
    const [error, setError] = useState("")
    const [isCreating, setIsCreating] = useState(false)

    // UI-only state for the new dashboard search + status filter (does not affect data/logic)
    const [search, setSearch] = useState("")
    const [filter, setFilter] = useState<"all" | "active" | "inactive">("all")

    // Id of the bot currently being exported (shows a spinner on its button).
    const [exportingId, setExportingId] = useState<string | null>(null)

    // Import-from-JSON dialog.
    const [showImport, setShowImport] = useState(false)

    // Alert when switching a journey ON clashes with an active journey's keyword.
    const [activationConflict, setActivationConflict] = useState<{ botId: string; name: string; conflicts: KeywordConflict[] } | null>(null)
    const [activationBusy, setActivationBusy] = useState(false)
    // Non-error info shown above the cards (e.g. activated without a number).
    const [notice, setNotice] = useState("")

    // ------------------->>> Getting all BOTS

    async function loadBots() {
        try {
            const res = await api.get("/api/chatbots")
            setBots(res.data)
        } catch (error) {
            setError("Failed to load chatbots")
        }
        finally {
            setIsLoading(false)
        }
    }

    // ----------------------->>> Creating the BOT

    async function handleCreate(e: React.FormEvent) {
        e.preventDefault()
        if (!newName.trim() || isCreating) return
        setIsCreating(true)
        setError("")
        try {
            // Create the chatbot, then open its flow builder.
            const res = await api.post("/api/chatbots", { name: newName.trim() })
            const created: Chatbot = res.data
            setNewName("")
            if (created?.id) {
                router.push(`/chatbots/${created.id}/builder`)
            } else {
                loadBots()
            }
        } catch (err) {
            setError("Failed to create chatbot")
            setIsCreating(false)
        }
    }

    // ----------------------->>> Renaming the BOT

    async function handleRename(id: string, current: string) {

        const res = await dialog.prompt({
            title: "Rename chatbot",
            fields: [{ name: "name", label: "Chatbot name", value: current, required: true }],
        })
        const name = res?.name
        if (!name) return
        await api.patch(`/api/chatbots/${id}`, { name })
        loadBots()

    }

    //  ---------------------->>> Handle BOT status 

    async function handleToggleActive(id: string, isActive: boolean) {
        setError("")
        setNotice("")
        try {
            const res = await api.patch(`/api/chatbots/${id}/activate`, { isActive: !isActive });
            // Keyword clashes are checked per WhatsApp number — a journey with no
            // number can't be checked (or reply), so say so instead of silently passing.
            if (!isActive && res.data?.notConnected) {
                const bot = bots.find((b) => b.id === id)
                setNotice(`“${bot?.name ?? "This journey"}” is active, but it isn't connected to a WhatsApp number yet, so it won't reply and its trigger keywords can't be checked against other journeys. Connect a number in its WhatsApp Settings.`)
            }
        } catch (err: any) {
            // Another ACTIVE journey on the same number shares a trigger keyword.
            const data = err?.response?.data
            if (err?.response?.status === 409 && data?.code === "KEYWORD_CONFLICT") {
                const bot = bots.find((b) => b.id === id)
                setActivationConflict({ botId: id, name: bot?.name ?? "this journey", conflicts: data.conflicts ?? [] })
            } else {
                setError(data?.error ?? "Couldn't change the bot's status.")
            }
        }
        loadBots();
    }

    // Alert action: switch the clashing journey(s) off, then activate this one.
    async function activateReplacingConflicts() {
        if (!activationConflict) return
        setActivationBusy(true)
        try {
            await api.patch(`/api/chatbots/${activationConflict.botId}/activate`, { isActive: true, deactivateConflicting: true })
            setActivationConflict(null)
        } catch (err: any) {
            setError(err?.response?.data?.error ?? "Couldn't activate the journey.")
            setActivationConflict(null)
        } finally {
            setActivationBusy(false)
            loadBots()
        }
    }

    //  ---------------------->>> Deletetion of BOT

    async function handleDelete(id: string) {
        const ok = await dialog.confirm({
            title: "Delete this chatbot?",
            message: "Its flow, versions and conversations will be removed. This can't be undone.",
            danger: true,
        });
        if (!ok) return;
        await api.delete(`/api/chatbots/${id}`);
        loadBots();
    }

    //  ---------------------->>> Export the bot's saved journey (draft) as JSON
    async function handleExport(bot: Chatbot) {
        if (exportingId) return
        setExportingId(bot.id)
        setError("")
        try {
            const res = await api.get(`/api/chatbots/${bot.id}/workflow/draft`)
            // The draft row carries the journey under `.definition`.
            const definition = res.data?.definition ?? res.data
            const data = wrapJourneyExport(definition, {
                chatbotId: bot.id,
                name: bot.name,
                isActive: bot.isActive,
                createdAt: bot.createdAt,
                source: "draft",
            })
            downloadJson(data, journeyFileName(bot.name))
        } catch (err: any) {
            setError(
                err?.response?.status === 404
                    ? "This chatbot has no saved journey to export yet."
                    : "Failed to export the journey."
            )
        } finally {
            setExportingId(null)
        }
    }




    useEffect(() => {
        if (!getToken()) {
            router.push("/login")
            return;
        }
        loadBots()
    }, [])

    // Derived counts + filtered list for the dashboard (client-side only)
    const activeCount = bots.filter((b) => b.isActive).length
    const inactiveCount = bots.length - activeCount

    const visibleBots = useMemo(() => {
        const q = search.toLowerCase().trim()
        return bots.filter((bot) => {
            const matchesSearch = !q || bot.name.toLowerCase().includes(q) || bot.id.toLowerCase().includes(q)
            const matchesFilter =
                filter === "all" || (filter === "active" && bot.isActive) || (filter === "inactive" && !bot.isActive)
            return matchesSearch && matchesFilter
        })
    }, [bots, search, filter])

    // ---------------------->>> Table pagination (client-side, real data only)
    const [pageSize, setPageSize] = useState(20)
    const [page, setPage] = useState(1)
    const pageCount = Math.max(1, Math.ceil(visibleBots.length / pageSize))
    const currentPage = Math.min(page, pageCount)
    const pageBots = visibleBots.slice((currentPage - 1) * pageSize, currentPage * pageSize)
    const firstRow = visibleBots.length ? (currentPage - 1) * pageSize + 1 : 0
    const lastRow = Math.min(currentPage * pageSize, visibleBots.length)
    // Back to page 1 whenever the search / filter / page size changes.
    useEffect(() => { setPage(1) }, [search, filter, pageSize])

    // "New Chatbot" in the header focuses the quick launcher input.
    const newNameRef = useRef<HTMLInputElement>(null)


    return (
        <div className="min-h-screen bg-slate-50 dark:bg-slate-950 font-sans text-slate-800 dark:text-slate-100 antialiased">
            {/* Shared workspace sidebar */}
            <Sidebar active="workflows" />

            <div className="pl-sidebar flex flex-col min-h-screen">
                {/* ===================== Top navbar ===================== */}
                <TopNav crumbs={[{ label: "Workflows & Bots" }]} />

                <main className="flex-1 px-6 py-8 space-y-6">
                    {/* ===================== Title + actions ===================== */}
                    <section className="space-y-4">
                        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                            <div>
                                <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-50">Chatbots</h1>
                                <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
                                    Create, test, and manage your WhatsApp chatbot flows and automated journeys.
                                </p>
                            </div>
                            <div className="flex items-center gap-2">
                                <button
                                    type="button"
                                    onClick={() => setShowImport(true)}
                                    className="inline-flex items-center gap-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3.5 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 hover:border-slate-300 shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 transition-all"
                                >
                                    <span className="material-symbols-outlined text-[16px] text-slate-500" aria-hidden="true">upload</span>
                                    Import Flow (JSON)
                                </button>

                            </div>
                        </div>

                        {/* Quick flow launcher */}
                        <div className="rounded-xl border border-emerald-100 dark:border-emerald-900/50 bg-gradient-to-r from-emerald-50/80 via-teal-50/40 to-white dark:from-emerald-950/40 dark:via-slate-900 dark:to-slate-900 p-4 shadow-sm">
                            <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-4">
                                <div className="flex items-center gap-3">
                                    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-600 text-white shadow-sm flex-shrink-0" aria-hidden="true">
                                        <span className="material-symbols-outlined text-[20px]">bolt</span>
                                    </div>
                                    <div>
                                        <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Quick Flow Launcher</h2>
                                        <p className="text-xs text-slate-500 dark:text-slate-400">Name your chatbot and jump straight into the visual workflow canvas.</p>
                                    </div>
                                </div>
                                <form onSubmit={handleCreate} className="flex flex-1 max-w-xl items-center gap-4">
                                    <div className="relative flex-1">
                                        <span className="material-symbols-outlined pointer-events-none absolute inset-y-0 left-3 top-1 flex items-center text-[16px] text-slate-400" aria-hidden="true">smart_toy</span>
                                        <label htmlFor="new-bot-name" className="sr-only">New chatbot name</label>
                                        <input
                                            id="new-bot-name"
                                            ref={newNameRef}
                                            value={newName}
                                            onChange={(e) => setNewName(e.target.value)}
                                            className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 ml-1 py-2 pl-9 pr-4 text-xs text-slate-800 dark:text-slate-100 placeholder-slate-400 focus:border-emerald-600 focus:outline-none focus:ring-1 focus:ring-emerald-600 shadow-sm"
                                            placeholder="e.g. Abandoned Cart Recovery Bot"
                                            type="text"
                                        />
                                    </div>
                                    <button
                                        type="submit"
                                        disabled={!newName.trim() || isCreating}
                                        className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg bg-emerald-600 dark:bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 dark:hover:bg-emerald-700 shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                        <span>{isCreating ? "Creating…" : "Create Flow"}</span>
                                        <span className="material-symbols-outlined text-[14px]" aria-hidden="true">arrow_forward</span>
                                    </button>
                                </form>
                            </div>
                        </div>
                    </section>

                    {/* ===================== Search + status tabs ===================== */}
                    <section className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 pt-2">
                        <div className="relative w-full sm:w-80">
                            <span className="material-symbols-outlined pointer-events-none absolute inset-y-0 left-3 top-1 flex items-center text-[16px] text-slate-400" aria-hidden="true">search</span>
                            <label htmlFor="bot-search" className="sr-only">Search chatbots</label>
                            <input
                                id="bot-search"
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                                className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 py-2 pl-9 pr-3 text-xs text-slate-800 dark:text-slate-100 placeholder-slate-400 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 shadow-sm"
                                placeholder="Search by name or ID..."
                                type="text"
                            />
                        </div>
                        <div role="tablist" aria-label="Filter by status" className="inline-flex rounded-lg bg-slate-200/60 dark:bg-slate-800 p-1 text-xs font-medium text-slate-600 dark:text-slate-300 self-start sm:self-auto">
                            {([
                                { key: "all", label: "All", count: bots.length, countCls: "text-slate-500" },
                                { key: "active", label: "Active", count: activeCount, countCls: "text-emerald-600 font-semibold" },
                                { key: "inactive", label: "Inactive", count: inactiveCount, countCls: "text-slate-500" },
                            ] as const).map((t) => (
                                <button
                                    key={t.key}
                                    type="button"
                                    role="tab"
                                    aria-selected={filter === t.key}
                                    onClick={() => setFilter(t.key)}
                                    className={`rounded-md px-3 py-1 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 ${filter === t.key
                                            ? "bg-white dark:bg-slate-900 font-semibold text-slate-900 dark:text-slate-100 shadow-sm"
                                            : "hover:text-slate-900 dark:hover:text-slate-100"
                                        }`}
                                >
                                    {t.label} <span className={`ml-1 text-[11px] ${t.countCls}`}>({t.count})</span>
                                </button>
                            ))}
                        </div>
                    </section>

                    {error && (
                        <div role="alert" className="p-3 rounded-lg border border-rose-200 bg-rose-50 dark:bg-rose-950/40 dark:border-rose-900 text-rose-700 dark:text-rose-300 text-xs font-medium">{error}</div>
                    )}
                    {notice && (
                        <div role="status" className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-900 text-xs font-medium flex items-start gap-2">
                            <span className="material-symbols-outlined text-[18px] text-amber-600" aria-hidden="true">info</span>
                            <span className="flex-1">{notice}</span>
                            <button type="button" onClick={() => setNotice("")} className="text-amber-700 hover:text-amber-900" aria-label="Dismiss">
                                <span className="material-symbols-outlined text-[18px]" aria-hidden="true">close</span>
                            </button>
                        </div>
                    )}

                    {/* ===================== Table ===================== */}
                    <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm overflow-hidden">
                        {isLoading ? (
                            <div className="flex justify-center py-16" role="status" aria-label="Loading chatbots">
                                <span className="w-8 h-8 rounded-full border-2 border-emerald-600 border-t-transparent animate-spin" />
                            </div>
                        ) : bots.length === 0 ? (
                            <EmptyState icon="smart_toy" title="No chatbots yet" text="Create your first one with the Quick Flow Launcher above, or import a journey JSON." />
                        ) : visibleBots.length === 0 ? (
                            <EmptyState icon="search_off" title="No chatbots match your search" text="Try a different name or ID, or reset the filters.">
                                <button
                                    type="button"
                                    onClick={() => { setSearch(""); setFilter("all") }}
                                    className="mt-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3.5 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50"
                                >
                                    Reset filters
                                </button>
                            </EmptyState>
                        ) : (
                            <>
                                <div className="overflow-x-auto">
                                    <table className="min-w-full divide-y divide-slate-200 dark:divide-slate-800 text-left text-xs text-slate-600 dark:text-slate-300">
                                        <thead className="bg-slate-50/80 dark:bg-slate-800/50 font-semibold uppercase tracking-wider text-[11px] text-slate-500 dark:text-slate-400">
                                            <tr>
                                                <th scope="col" className="py-3.5 pl-4 pr-3 sm:pl-6">Bot Name &amp; ID</th>
                                                <th scope="col" className="px-3 py-3.5">Status</th>
                                                <th scope="col" className="px-3 py-3.5">Version</th>
                                                <th scope="col" className="px-3 py-3.5">Created Date</th>
                                                <th scope="col" className="px-3 py-3.5">Last Modified</th>
                                                <th scope="col" className="py-3.5 pl-3 pr-4 sm:pr-6 text-center">Actions</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                                            {pageBots.map((bot) => {
                                                const tone = toneFor(bot.id)
                                                return (
                                                    <tr key={bot.id} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors group">
                                                        {/* Name + id */}
                                                        <td className="whitespace-nowrap py-4 pl-4 pr-3 sm:pl-6">
                                                            <div className="flex items-center gap-3">
                                                                <div className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl ring-1 ${tone}`} aria-hidden="true">
                                                                    <span className="material-symbols-outlined text-[20px]">smart_toy</span>
                                                                </div>
                                                                <div className="flex flex-col min-w-0">
                                                                    <EditableBotName
                                                                        botId={bot.id}
                                                                        name={bot.name}
                                                                        onClick={() => router.push(`/chatbots/${bot.id}/builder`)}
                                                                        onRenamed={(name) => setBots((bs) => bs.map((b) => (b.id === bot.id ? { ...b, name } : b)))}
                                                                        className="font-semibold text-sm text-slate-900 dark:text-slate-100 group-hover:text-emerald-700 dark:group-hover:text-emerald-400 transition-colors cursor-pointer truncate max-w-[22rem]"
                                                                        inputClassName="text-sm font-semibold"
                                                                    />
                                                                    <span className="font-mono text-[11px] text-slate-400 mt-0.5">
                                                                        ID: <span className="text-slate-600 dark:text-slate-300 font-medium">#{bot.id.slice(0, 8)}</span>
                                                                    </span>
                                                                </div>
                                                            </div>
                                                        </td>

                                                        {/* Toggle + Live / Paused */}
                                                        <td className="whitespace-nowrap px-3 py-4">
                                                            <div className="flex items-center gap-2.5">
                                                                <label className="relative inline-flex cursor-pointer items-center">
                                                                    <input
                                                                        type="checkbox"
                                                                        className="peer sr-only"
                                                                        checked={bot.isActive}
                                                                        onChange={() => handleToggleActive(bot.id, bot.isActive)}
                                                                        aria-label={`${bot.isActive ? "Deactivate" : "Activate"} ${bot.name}`}
                                                                    />
                                                                    <div className="h-5 w-9 rounded-full !bg-slate-200 dark:!bg-slate-700 peer-checked:!bg-emerald-600 peer-focus-visible:ring-2 peer-focus-visible:ring-emerald-500 peer-focus-visible:ring-offset-2 after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:after:translate-x-full" />
                                                                </label>
                                                                {bot.isActive ? (
                                                                    <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 dark:bg-emerald-900/30 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-700 dark:text-emerald-300 ring-1 ring-inset ring-emerald-600/20">
                                                                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden="true" />
                                                                        Live
                                                                    </span>
                                                                ) : (
                                                                    <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 dark:bg-slate-800 px-2.5 py-0.5 text-[11px] font-semibold text-slate-600 dark:text-slate-300 ring-1 ring-inset ring-slate-500/20">
                                                                        <span className="h-1.5 w-1.5 rounded-full bg-slate-400" aria-hidden="true" />
                                                                        Paused
                                                                    </span>
                                                                )}
                                                            </div>
                                                        </td>

                                                        {/* Published or draft only */}
                                                        <td className="whitespace-nowrap px-3 py-4">
                                                            {bot.activeVersionId ? (
                                                                <div className="flex flex-col">
                                                                    <span className="font-semibold text-emerald-500 dark:text-emerald-300">{bot.isActive ? "Published" : "Turn on to reply"}</span>
                                                                </div>
                                                            ) : (
                                                                <div className="flex flex-col">
                                                                    <span className="font-semibold text-slate-800 dark:text-slate-100">Draft only</span>
                                                                    <span className="text-[11px] text-amber-600 font-medium">Publish to go live</span>
                                                                </div>
                                                            )}
                                                        </td>

                                                        <td className="whitespace-nowrap px-3 py-4 font-medium text-slate-600 dark:text-slate-300">
                                                            {bot.createdAt ? new Date(bot.createdAt).toLocaleDateString() : "—"}
                                                        </td>
                                                        <td className="whitespace-nowrap px-3 py-4 text-slate-500 dark:text-slate-400" title={bot.updatedAt ? new Date(bot.updatedAt).toLocaleString() : undefined}>
                                                            {relativeTime(bot.updatedAt)}
                                                        </td>

                                                        {/* Actions */}
                                                        <td className="whitespace-nowrap py-4 pl-3 pr-4 sm:pr-6 text-right">
                                                            <div className="flex items-center justify-end gap-1.5">
                                                                <Link
                                                                    href={`/chatbots/${bot.id}/builder`}
                                                                    className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-semibold shadow-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 ${bot.isActive
                                                                            ? "bg-emerald-600 text-white hover:bg-emerald-700"
                                                                            : "bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700"
                                                                        }`}
                                                                >
                                                                    <span className="material-symbols-outlined text-[14px]" aria-hidden="true">edit_square</span>
                                                                    Build Flow
                                                                </Link>
                                                                <IconLink href={`/chatbots/${bot.id}/conversation`} icon="forum" label="Chats Log" />
                                                                <IconLink href={`/chatbots/${bot.id}/analytics`} icon="insights" label="Analytics" />
                                                                <IconButton
                                                                    icon={exportingId === bot.id ? "progress_activity" : "download"}
                                                                    label={exportingId === bot.id ? "Exporting…" : "Export JSON"}
                                                                    onClick={() => handleExport(bot)}
                                                                    disabled={exportingId === bot.id}
                                                                    spin={exportingId === bot.id}
                                                                />
                                                                <IconButton icon="edit" label="Rename" onClick={() => handleRename(bot.id, bot.name)} />
                                                                <IconButton icon="delete" label="Delete Bot" danger onClick={() => handleDelete(bot.id)} />
                                                            </div>
                                                        </td>
                                                    </tr>
                                                )
                                            })}
                                        </tbody>
                                    </table>
                                </div>

                                {/* Pagination */}
                                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-t border-slate-200 dark:border-slate-800 px-4 py-3.5 sm:px-6">
                                    <p className="text-xs text-slate-500 dark:text-slate-400" aria-live="polite">
                                        Showing <span className="font-semibold text-slate-900 dark:text-slate-100">{firstRow}</span> to{" "}
                                        <span className="font-semibold text-slate-900 dark:text-slate-100">{lastRow}</span> of{" "}
                                        <span className="font-semibold text-slate-900 dark:text-slate-100">{visibleBots.length}</span> chatbots
                                    </p>
                                    <div className="flex items-center gap-2">
                                        <label htmlFor="rows-per-page" className="text-xs text-slate-500 dark:text-slate-400">Rows per page:</label>
                                        <select
                                            id="rows-per-page"
                                            value={pageSize}
                                            onChange={(e) => setPageSize(Number(e.target.value))}
                                            className="rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 py-1 pl-2.5 pr-7 text-xs font-semibold text-slate-700 dark:text-slate-200 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 cursor-pointer"
                                        >
                                            {[20, 40, 60].map((n) => <option key={n} value={n}>{n}</option>)}
                                        </select>
                                    </div>
                                    <nav aria-label="Pagination" className="inline-flex -space-x-px rounded-md shadow-sm">
                                        <PageButton onClick={() => setPage(currentPage - 1)} disabled={currentPage <= 1} className="rounded-l-md">
                                            <span className="material-symbols-outlined text-[16px]" aria-hidden="true">chevron_left</span>
                                            <span className="ml-1 hidden sm:inline">Previous</span>
                                        </PageButton>
                                        {pageList(currentPage, pageCount).map((p, i) =>
                                            p === "…" ? (
                                                <span key={`gap-${i}`} className="inline-flex items-center border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-1.5 text-xs text-slate-400">…</span>
                                            ) : (
                                                <PageButton key={p} onClick={() => setPage(p)} current={p === currentPage}>{p}</PageButton>
                                            )
                                        )}
                                        <PageButton onClick={() => setPage(currentPage + 1)} disabled={currentPage >= pageCount} className="rounded-r-md">
                                            <span className="mr-1 hidden sm:inline">Next</span>
                                            <span className="material-symbols-outlined text-[16px]" aria-hidden="true">chevron_right</span>
                                        </PageButton>
                                    </nav>
                                </div>
                            </>
                        )}
                    </section>
                </main>
            </div>

            {activationConflict && (
                <ActivationConflictDialog
                    journeyName={activationConflict.name}
                    conflicts={activationConflict.conflicts}
                    busy={activationBusy}
                    onDeactivateOthers={activateReplacingConflicts}
                    onEditKeywords={() => { const id = activationConflict.botId; setActivationConflict(null); router.push(`/chatbots/${id}/builder`) }}
                    onCancel={() => setActivationConflict(null)}
                />
            )}

            <ImportJourneyDialog
                open={showImport}
                onClose={() => setShowImport(false)}
                onImported={(botId) => { setShowImport(false); router.push(`/chatbots/${botId}/builder`) }}
            />
        </div>
    );
}

// ---------------------------------------------------------------------------
// Small presentational helpers for the table
// ---------------------------------------------------------------------------

// A stable accent per bot (from its id) so rows are easy to tell apart.
const TONES = [
    "bg-emerald-50 text-emerald-600 ring-emerald-500/20 dark:bg-emerald-900/30 dark:text-emerald-300",
    "bg-blue-50 text-blue-600 ring-blue-500/20 dark:bg-blue-900/30 dark:text-blue-300",
    "bg-purple-50 text-purple-600 ring-purple-500/20 dark:bg-purple-900/30 dark:text-purple-300",
    "bg-amber-50 text-amber-600 ring-amber-500/20 dark:bg-amber-900/30 dark:text-amber-300",
    "bg-slate-100 text-slate-600 ring-slate-400/20 dark:bg-slate-800 dark:text-slate-300",
]
function toneFor(id: string) {
    let h = 0
    for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
    return TONES[h % TONES.length]
}

// "Just now", "15 mins ago", "2 hours ago", "Yesterday", "3 days ago", else a date.
function relativeTime(iso?: string) {
    if (!iso) return "—"
    const diff = Date.now() - new Date(iso).getTime()
    const min = Math.floor(diff / 60_000)
    if (min < 1) return "Just now"
    if (min < 60) return `${min} min${min === 1 ? "" : "s"} ago`
    const hrs = Math.floor(min / 60)
    if (hrs < 24) return `${hrs} hour${hrs === 1 ? "" : "s"} ago`
    const days = Math.floor(hrs / 24)
    if (days === 1) return "Yesterday"
    if (days < 7) return `${days} days ago`
    return new Date(iso).toLocaleDateString()
}

// Page numbers with gaps: 1 … 4 5 6 … 12
function pageList(current: number, total: number): (number | "…")[] {
    if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1)
    const set = new Set([1, total, current - 1, current, current + 1].filter((p) => p >= 1 && p <= total))
    const sorted = [...set].sort((a, b) => a - b)
    const out: (number | "…")[] = []
    sorted.forEach((p, i) => {
        if (i && p - sorted[i - 1] > 1) out.push("…")
        out.push(p)
    })
    return out
}

const iconBtn = "inline-flex rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 transition-colors disabled:opacity-50"

function IconLink({ href, icon, label }: { href: string; icon: string; label: string }) {
    return (
        <Link href={href} className={iconBtn} title={label} aria-label={label}>
            <span className="material-symbols-outlined text-[18px]" aria-hidden="true">{icon}</span>
        </Link>
    )
}

function IconButton({ icon, label, onClick, danger, disabled, spin }: { icon: string; label: string; onClick: () => void; danger?: boolean; disabled?: boolean; spin?: boolean }) {
    return (
        <button
            type="button"
            onClick={onClick}
            disabled={disabled}
            title={label}
            aria-label={label}
            className={`${iconBtn} ${danger ? "hover:!bg-rose-50 hover:!text-rose-600 dark:hover:!bg-rose-950/40" : ""}`}
        >
            <span className={`material-symbols-outlined text-[18px] ${spin ? "animate-spin" : ""}`} aria-hidden="true">{icon}</span>
        </button>
    )
}

function PageButton({ children, onClick, disabled, current, className = "" }: { children: React.ReactNode; onClick: () => void; disabled?: boolean; current?: boolean; className?: string }) {
    return (
        <button
            type="button"
            onClick={onClick}
            disabled={disabled}
            aria-current={current ? "page" : undefined}
            className={`relative inline-flex items-center border px-3 py-1.5 text-xs font-medium focus:z-20 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed ${current
                    ? "z-10 border-emerald-600 bg-emerald-50 dark:bg-emerald-900/30 font-semibold text-emerald-700 dark:text-emerald-300"
                    : "border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
                } ${className}`}
        >
            {children}
        </button>
    )
}

function EmptyState({ icon, title, text, children }: { icon: string; title: string; text: string; children?: React.ReactNode }) {
    return (
        <div className="p-12 text-center flex flex-col items-center justify-center gap-3">
            <div className="w-12 h-12 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-500" aria-hidden="true">
                <span className="material-symbols-outlined text-[28px]">{icon}</span>
            </div>
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{title}</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 max-w-sm">{text}</p>
            {children}
        </div>
    )
}