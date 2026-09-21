"use client";

import { api } from "@/lib/api";
import { getToken } from "@/lib/auth";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

// Shape of the safe connection returned from the backend (no secret values).
interface SafeConnection {
    businessName: string | null;
    phoneNumber: string | null;
    phoneNumberId: string | null;
    wabaId: string | null;
    status: string;
    hasAccessToken: boolean;
    hasAppSecret: boolean;
}

export default function SettingsPage() {
    const router = useRouter();
    const params = useParams();
    const chatbotId = params.id as string;

    // Form fields
    const [businessName, setBusinessName] = useState("");
    const [phoneNumber, setPhoneNumber] = useState("");
    const [phoneNumberId, setPhoneNumberId] = useState("");
    const [wabaId, setWabaId] = useState("");
    const [accessToken, setAccessToken] = useState("");
    const [appSecret, setAppSecret] = useState("");
    const [verifyToken, setVerifyToken] = useState("");

    const [existing, setExisting] = useState<SafeConnection | null>(null);
    const [loading, setLoading] = useState(true);
    const [message, setMessage] = useState("");

    async function loadConnection() {
        try {
            const res = await api.get(`/api/chatbots/${chatbotId}/connection`);
            const conn: SafeConnection = res.data;
            setExisting(conn);
            // Prefill the SAFE (non-secret) fields. Secrets stay blank.
            setBusinessName(conn.businessName ?? "");
            setPhoneNumber(conn.phoneNumber ?? "");
            setPhoneNumberId(conn.phoneNumberId ?? "");
            setWabaId(conn.wabaId ?? "");
        } catch (err: any) {
            // 404 = no connection configured yet. That's fine; show empty form.
            if (err.response?.status !== 404) {
                setMessage("Failed to load connection");
            }
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => {
        if (!getToken()) {
            router.push("/login");
            return;
        }
        loadConnection();
    }, []);

    async function handleSave(e: React.FormEvent) {
        e.preventDefault();
        setMessage("");

        // Only include secret fields if the user typed one, so we don't
        // overwrite a saved token with an empty string.
        const payload: Record<string, string> = {
            businessName,
            phoneNumber,
            phoneNumberId,
            wabaId,
        };
        if (accessToken) payload.accessToken = accessToken;
        if (appSecret) payload.appSecret = appSecret;
        if (verifyToken) payload.verifyToken = verifyToken;

        try {
            await api.put(`/api/chatbots/${chatbotId}/connection`, payload);
            setMessage("Saved.");
            // Clear the secret inputs and refresh the "configured" indicators.
            setAccessToken("");
            setAppSecret("");
            setVerifyToken("");
            loadConnection();
        } catch {
            setMessage("Failed to save");
        }
    }

    return (
        <main className="max-w-xl mx-auto p-6">
            <Link href="/chatbots" className="link link-primary">← Back to chatbots</Link>
            <h1 className="text-2xl font-bold my-4">WhatsApp Settings</h1>

            {loading ? (
                <p className="text-base-content/60">Loading...</p>
            ) : (
                <div className="card bg-base-100 shadow-xl">
                    <div className="card-body">
                        <form onSubmit={handleSave} className="flex flex-col gap-3">
                            <label className="form-control w-full">
                                <span className="label-text">Business name</span>
                                <input value={businessName} onChange={(e) => setBusinessName(e.target.value)} className="input input-bordered w-full" />
                            </label>
                            <label className="form-control w-full">
                                <span className="label-text">Phone number</span>
                                <input value={phoneNumber} onChange={(e) => setPhoneNumber(e.target.value)} className="input input-bordered w-full" />
                            </label>
                            <label className="form-control w-full">
                                <span className="label-text">Phone Number ID</span>
                                <input value={phoneNumberId} onChange={(e) => setPhoneNumberId(e.target.value)} className="input input-bordered w-full" />
                            </label>
                            <label className="form-control w-full">
                                <span className="label-text">WABA ID</span>
                                <input value={wabaId} onChange={(e) => setWabaId(e.target.value)} className="input input-bordered w-full" />
                            </label>

                            <div className="divider"></div>
                            <p className="text-sm text-base-content/60">
                                Secrets are write-only. Leave blank to keep the current value.
                            </p>

                            <label className="form-control w-full">
                                <span className="label-text">
                                    Access Token {existing?.hasAccessToken && <span className="badge badge-success badge-sm ml-2">✓ set</span>}
                                </span>
                                <input type="password" value={accessToken} onChange={(e) => setAccessToken(e.target.value)} placeholder="••••••••" className="input input-bordered w-full" />
                            </label>
                            <label className="form-control w-full">
                                <span className="label-text">
                                    App Secret {existing?.hasAppSecret && <span className="badge badge-success badge-sm ml-2">✓ set</span>}
                                </span>
                                <input type="password" value={appSecret} onChange={(e) => setAppSecret(e.target.value)} placeholder="••••••••" className="input input-bordered w-full" />
                            </label>
                            <label className="form-control w-full">
                                <span className="label-text">Verify Token</span>
                                <input type="password" value={verifyToken} onChange={(e) => setVerifyToken(e.target.value)} placeholder="••••••••" className="input input-bordered w-full" />
                            </label>

                            {message && (
                                <p className={message === "Saved." ? "text-success" : "text-error"}>{message}</p>
                            )}

                            <button type="submit" className="btn btn-primary">Save</button>
                        </form>
                    </div>
                </div>
            )}
        </main>
    );

}
