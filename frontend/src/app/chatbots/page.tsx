"use client"

import { api } from "@/lib/api";
import { clearToken, getToken } from "@/lib/auth";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";



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

    // ------------------->>> Getting all BOTS

    async function loadBots() {
        try {
            const res = await api.get("/api/chatbots")
            setBots(res.data)
        } catch (error) {
            setError("Failed to lead chatbots")
        }
        finally {
            setIsLoading(false)
        }
    }

    // ----------------------->>> Creating the BOT

    async function handleCreate(e: React.FormEvent) {
        e.preventDefault()
        if (!newName.trim()) return
        await api.post("/api/chatbots", { name: newName })                        // -------------------->>> Creation of chatBot
        setNewName("")
        loadBots()
    }

    // ----------------------->>> Renaming the BOT

    async function handleRename(id: string, current: string) {

        const name = window.prompt("New name", current)
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
        if (!window.confirm("Delete this chatbot?")) return;
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

    return (
        <div className="min-h-screen">
            {/* Top nav */}
            <nav className="navbar bg-base-100 border-b border-base-300 px-6 sticky top-0 z-10">
                <div className="flex-1">
                    <Link href="/" className="text-lg font-bold flex items-center gap-2">
                        <span className="text-xl">💬</span> WA AI Tool
                    </Link>
                </div>
                <Link href="/contacts" className="btn btn-ghost btn-sm">Contacts</Link>
                <button onClick={handleLogout} className="btn btn-ghost btn-sm">Log out</button>
            </nav>

            <main className="max-w-4xl mx-auto p-6">
                <div className="flex items-end justify-between mb-6">
                    <div>
                        <h1 className="text-2xl font-bold">My Chatbots</h1>
                        <p className="text-base-content/60 text-sm">Create and manage your WhatsApp workflows.</p>
                    </div>
                </div>

                {/* Create form */}
                <form onSubmit={handleCreate} className="join w-full mb-6">
                    <input
                        value={newName}
                        onChange={(e) => setNewName(e.target.value)}
                        placeholder="New chatbot name"
                        className="input input-bordered join-item flex-1"
                    />
                    <button type="submit" className="btn btn-primary join-item">Create</button>
                </form>

                {error && <div className="alert alert-error mb-4">{error}</div>}

                {isLoading ? (
                    <div className="flex justify-center py-16"><span className="loading loading-spinner loading-lg text-primary"></span></div>
                ) : bots.length === 0 ? (
                    <div className="card bg-base-100 shadow-sm">
                        <div className="card-body items-center text-center py-16">
                            <div className="text-4xl mb-2">🤖</div>
                            <h3 className="font-semibold">No chatbots yet</h3>
                            <p className="text-base-content/60">Create your first one using the box above.</p>
                        </div>
                    </div>
                ) : (
                    <div className="grid border gap-4 ">
                        {bots.map((bot) => (
                            <div key={bot.id} className="card bg-base-100 shadow-sm hover:shadow-md transition-shadow">
                                <div className="card-body">
                                    <div className="flex items-start justify-between gap-2">
                                        <h3 className="card-title text-base">{bot.name}</h3>
                                        <span className={bot.isActive ? "badge badge-success gap-1" : "badge badge-ghost gap-1"}>
                                            {bot.isActive ? "Active" : "Inactive"}
                                        </span>
                                    </div>
                                    <div className="card-actions mt-3 flex-wrap">
                                        <Link href={`/chatbots/${bot.id}/builder`} className="btn btn-primary btn-sm">Build</Link>
                                        <Link href={`/chatbots/${bot.id}/conversation`} className="btn btn-sm btn-outline">Chats</Link>
                                        <Link href={`/chatbots/${bot.id}/settings`} className="btn btn-sm btn-outline">Settings</Link>
                                        <button onClick={() => handleRename(bot.id, bot.name)} className="btn btn-sm btn-ghost">Rename</button>
                                        <button onClick={() => handleToggleActive(bot.id, bot.isActive)} className="btn btn-sm btn-ghost">
                                            {bot.isActive ? "Deactivate" : "Activate"}
                                        </button>
                                        <button onClick={() => handleDelete(bot.id)} className="btn btn-sm btn-ghost text-error">Delete</button>
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