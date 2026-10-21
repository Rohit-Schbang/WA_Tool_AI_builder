"use client"

import { api } from "@/lib/api";
import { clearToken, getToken } from "@/lib/auth";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Sidebar } from "@/app/components/Sidebar";
import { EditableBotName } from "@/app/components/EditableBotName";
import { dialog } from "@/app/components/Dialog";



// Shape of the Chat Bot returned by the backend

interface Chatbot {
    id: string;
    name: string;
    isActive: boolean;
    createdAt: string;
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
        await api.patch(`/api/chatbots/${id}/activate`, { isActive: !isActive });
        loadBots();
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

    //  ---------------------->>> Logout Re-reouter
    function handleLogout() {
        clearToken();
        router.push("/login");
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

    return (
        <div className="bg-surface font-sans text-on-surface antialiased min-h-screen">
            {/* Sidebar */}
            <Sidebar active="workflows" />

            {/* Main area */}
            <div className="pl-72 flex flex-col min-h-screen">
                {/* Header */}
                <header className="fixed top-0 left-72 right-0 h-16 bg-surface/85 backdrop-blur-xl shadow-[0_1px_8px_rgba(0,0,0,0.04)] z-40 flex items-center justify-between px-space-lg">
                    <div />
                    <div className="flex items-center gap-space-md">
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
                    <div className="p-space-lg lg:p-space-xl max-w-[1440px] mx-auto w-full flex flex-col gap-space-lg">
                        {/* 1. Header & welcome */}
                        <div className="flex flex-col md:flex-row md:items-center justify-between gap-space-md pb-2">
                            <div className="flex flex-col">
                                <h1 className="font-headline-xl text-headline-xl text-on-surface tracking-tight">Chatbots</h1>
                                <p className="font-body-md text-body-md text-on-surface-variant mt-1">
                                    Create, test, and manage your WhatsApp chatbot flows.
                                </p>
                            </div>
                        </div>

                        {/* 2. Quick launch */}
                        <div className="p-space-lg rounded-2xl bg-surface-container-lowest shadow-sm relative overflow-hidden flex flex-col lg:flex-row items-start lg:items-center justify-between gap-space-md">
                            <div className="absolute -right-12 -top-12 w-48 h-48 rounded-full bg-gradient-to-br from-primary-fixed/20 to-secondary-fixed/30 blur-2xl pointer-events-none"></div>
                            <div className="flex flex-col gap-2 max-w-xl w-full">
                                <div className="flex items-center gap-2">
                                    <span className="material-symbols-outlined text-primary text-[20px]">bolt</span>
                                    <span className="font-headline-sm text-headline-sm text-on-surface">New chatbot</span>
                                </div>
                                <form onSubmit={handleCreate} className="flex items-center gap-2 w-full mt-1">
                                    <div className="relative flex-1">
                                        <span className="material-symbols-outlined absolute left-3 top-2.5 text-on-surface-variant text-[20px]">smart_toy</span>
                                        <input
                                            value={newName}
                                            onChange={(e) => setNewName(e.target.value)}
                                            className="w-full h-11 pl-10 pr-4 rounded-xl bg-surface-container-low text-on-surface font-body-md text-body-md placeholder:text-on-surface-variant/60 focus:bg-surface-container-lowest focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all"
                                            placeholder="e.g. Abandoned Cart Recovery Bot"
                                            type="text"
                                        />
                                    </div>
                                    <button
                                        type="submit"
                                        disabled={!newName.trim() || isCreating}
                                        className="h-11 px-5 rounded-xl bg-primary text-on-primary font-label-lg text-label-lg font-semibold inline-flex items-center gap-1.5 hover:bg-primary-container active:scale-[0.99] transition-all whitespace-nowrap shadow-sm disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-primary disabled:active:scale-100"
                                    >
                                        <span>{isCreating ? "Creating..." : "Create Flow"}</span>
                                        <span className="material-symbols-outlined text-[18px]">arrow_forward</span>
                                    </button>
                                </form>
                            </div>
                        </div>

                        {/* 3. Search + filters */}
                        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-space-sm">
                            <div className="relative max-w-md w-full">
                                <span className="material-symbols-outlined absolute left-3.5 top-2.5 text-on-surface-variant text-[18px]">search</span>
                                <input
                                    value={search}
                                    onChange={(e) => setSearch(e.target.value)}
                                    className="w-full h-10 pl-10 pr-4 rounded-xl bg-surface-container-lowest text-on-surface font-body-md text-body-md placeholder:text-on-surface-variant/50 shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                                    placeholder="Search by name or ID..."
                                    type="text"
                                />
                            </div>
                            <div className="flex items-center gap-2 overflow-x-auto pb-1 sm:pb-0">
                                <div className="flex items-center p-1 rounded-xl bg-surface-container-low">
                                    {([
                                        { key: "all", label: `All (${bots.length})` },
                                        { key: "active", label: `Active (${activeCount})` },
                                        { key: "inactive", label: `Inactive (${inactiveCount})` },
                                    ] as const).map((pill) => (
                                        <button
                                            key={pill.key}
                                            onClick={() => setFilter(pill.key)}
                                            className={`px-3 py-1.5 rounded-lg font-label-md text-label-md transition-all ${
                                                filter === pill.key
                                                    ? "bg-surface-container-lowest text-primary font-semibold shadow-xs"
                                                    : "text-on-surface-variant hover:text-on-surface"
                                            }`}
                                        >
                                            {pill.label}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        </div>

                        {error && (
                            <div className="p-3 rounded-xl bg-error-container text-on-error-container font-label-md text-label-md">{error}</div>
                        )}

                        {/* 4. Bot cards grid */}
                        {isLoading ? (
                            <div className="flex justify-center py-16">
                                <span className="w-8 h-8 rounded-full border-2 border-primary border-t-transparent animate-spin" />
                            </div>
                        ) : bots.length === 0 ? (
                            <div className="p-12 rounded-2xl bg-surface-container-lowest text-center flex flex-col items-center justify-center gap-3">
                                <div className="w-12 h-12 rounded-full bg-surface-container-high flex items-center justify-center text-on-surface-variant">
                                    <span className="material-symbols-outlined text-[28px]">smart_toy</span>
                                </div>
                                <span className="font-headline-sm text-headline-sm text-on-surface">No chatbots yet</span>
                                <p className="font-body-md text-body-md text-on-surface-variant max-w-sm">Create your first one using the box above.</p>
                            </div>
                        ) : visibleBots.length === 0 ? (
                            <div className="p-12 rounded-2xl bg-surface-container-lowest text-center flex flex-col items-center justify-center gap-3">
                                <div className="w-12 h-12 rounded-full bg-surface-container-high flex items-center justify-center text-on-surface-variant">
                                    <span className="material-symbols-outlined text-[28px]">search_off</span>
                                </div>
                                <span className="font-headline-sm text-headline-sm text-on-surface">No chatbots match your criteria</span>
                                <p className="font-body-md text-body-md text-on-surface-variant max-w-sm">Try adjusting your filters or searching for a different keyword.</p>
                                <button
                                    onClick={() => { setSearch(""); setFilter("all"); }}
                                    className="mt-2 px-4 py-2 rounded-lg bg-surface-container-high hover:bg-surface-container text-on-surface font-label-md text-label-md font-semibold transition-all"
                                >
                                    Reset Filters
                                </button>
                            </div>
                        ) : (
                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-space-lg">
                                {visibleBots.map((bot) => (
                                    <div key={bot.id} className="p-space-lg rounded-2xl bg-surface-container-lowest shadow-sm hover:shadow-md transition-all flex flex-col justify-between gap-space-md group">
                                        <div className="flex flex-col gap-3">
                                            {/* Card head */}
                                            <div className="flex items-start justify-between gap-2">
                                                <div className="flex items-center gap-3">
                                                    <div className={`w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 ${bot.isActive ? "bg-primary-fixed/30 text-primary" : "bg-surface-container-high text-on-surface-variant"}`}>
                                                        <span className="material-symbols-outlined text-[26px]">smart_toy</span>
                                                    </div>
                                                    <div className="flex flex-col">
                                                        <div className="flex items-center gap-2">
                                                            <EditableBotName
                                                                as="h2"
                                                                botId={bot.id}
                                                                name={bot.name}
                                                                onClick={() => router.push(`/chatbots/${bot.id}/builder`)}
                                                                onRenamed={(name) => setBots((bs) => bs.map((b) => (b.id === bot.id ? { ...b, name } : b)))}
                                                                className="font-headline-sm text-headline-sm text-on-surface font-bold group-hover:text-primary transition-colors"
                                                                inputClassName="text-base font-bold"
                                                            />
                                                            {bot.isActive ? (
                                                                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-primary-fixed/40 text-on-primary-fixed-variant font-label-sm text-label-sm font-semibold">
                                                                    <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse"></span>
                                                                    Active
                                                                </span>
                                                            ) : (
                                                                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-surface-container-high text-on-surface-variant font-label-sm text-label-sm font-semibold">
                                                                    <span className="w-1.5 h-1.5 rounded-full bg-outline"></span>
                                                                    Inactive
                                                                </span>
                                                            )}
                                                        </div>
                                                        <span className="font-body-sm text-body-sm text-on-surface-variant">
                                                            ID: #{bot.id.slice(0, 8)}
                                                        </span>
                                                    </div>
                                                </div>
                                                {/* Toggle + actions */}
                                                <div className="flex items-center gap-2">
                                                    <label className="relative inline-flex items-center cursor-pointer">
                                                        <input
                                                            type="checkbox"
                                                            className="sr-only peer"
                                                            checked={bot.isActive}
                                                            onChange={() => handleToggleActive(bot.id, bot.isActive)}
                                                        />
                                                        <div className="w-10 h-6 bg-surface-container-highest peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary"></div>
                                                    </label>
                                                    <button
                                                        onClick={() => handleRename(bot.id, bot.name)}
                                                        className="p-1.5 rounded-lg text-on-surface-variant hover:bg-surface-container-high transition-all"
                                                        title="Rename (or double-click the name)"
                                                    >
                                                        <span className="material-symbols-outlined text-[20px]">edit</span>
                                                    </button>
                                                </div>
                                            </div>

                                            {/* Status + created date (real data only) */}
                                            <div className="grid grid-cols-2 gap-2 pt-1">
                                                <div className="p-2.5 rounded-xl bg-surface-container-low/70 flex flex-col">
                                                    <span className="font-label-sm text-label-sm text-on-surface-variant uppercase">Status</span>
                                                    <span className="font-headline-sm text-headline-sm text-on-surface font-semibold">{bot.isActive ? "Live" : "Paused"}</span>
                                                </div>
                                                <div className="p-2.5 rounded-xl bg-surface-container-low/70 flex flex-col">
                                                    <span className="font-label-sm text-label-sm text-on-surface-variant uppercase">Created</span>
                                                    <span className="font-headline-sm text-headline-sm text-primary font-semibold">
                                                        {bot.createdAt ? new Date(bot.createdAt).toLocaleDateString() : "—"}
                                                    </span>
                                                </div>
                                            </div>
                                        </div>

                                        {/* Action buttons footer */}
                                        <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
                                            <div className="flex items-center gap-2">
                                                <Link
                                                    href={`/chatbots/${bot.id}/builder`}
                                                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary text-on-primary font-label-md text-label-md font-semibold hover:bg-primary-container shadow-xs active:scale-[0.98] transition-all"
                                                >
                                                    <span className="material-symbols-outlined text-[16px]">account_tree</span>
                                                    <span>Build Flow</span>
                                                </Link>
                                                <Link
                                                    href={`/chatbots/${bot.id}/conversation`}
                                                    className="inline-flex items-center gap-1 px-3 py-2 rounded-lg bg-surface-container-high hover:bg-surface-container text-on-surface font-label-md text-label-md font-medium transition-all"
                                                >
                                                    <span className="material-symbols-outlined text-[16px]">forum</span>
                                                    <span>Chats Log</span>
                                                </Link>
                                                <Link
                                                    href={`/chatbots/${bot.id}/analytics`}
                                                    className="inline-flex items-center gap-1 px-3 py-2 rounded-lg bg-surface-container-high hover:bg-surface-container text-on-surface font-label-md text-label-md font-medium transition-all"
                                                >
                                                    <span className="material-symbols-outlined text-[16px]">insights</span>
                                                    <span>Analytics</span>
                                                </Link>
                                            </div>
                                            <div className="flex items-center gap-1">
                                                <button
                                                    onClick={() => handleDelete(bot.id)}
                                                    className="p-2 rounded-lg text-error hover:bg-error-container/30 transition-all"
                                                    title="Delete Bot"
                                                >
                                                    <span className="material-symbols-outlined text-[18px]">delete</span>
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}

                    </div>
                </main>
            </div>
        </div>
    );
}
