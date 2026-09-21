"use client";

import { api } from "@/lib/api";
import { saveToken } from "@/lib/auth";
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function LoginPage() {
  const router = useRouter();

  // Current mode: login or register
  const [mode, setMode] = useState<"login" | "register">("login");

  // Form inputs
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");

  // UI state
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setIsLoading(true);

    try {
      const path = mode === "login" ? "/api/auth/login" : "/api/auth/register";
      const payload = mode === "login" ? { email, password } : { email, name, password };
      const res = await api.post(path, payload);
      saveToken(res.data.token);
      router.push("/chatbots");
    } catch (error: any) {
      setError(error.response?.data?.error ?? "Something went wrong");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="card w-full max-w-sm bg-base-100 shadow-xl">
        <div className="card-body">
          <h1 className="card-title text-2xl">
            {mode === "login" ? "Log in" : "Create account"}
          </h1>

          <form onSubmit={handleSubmit} className="flex flex-col gap-3">
            <label className="form-control w-full">
              <span className="label-text">Email</span>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="input input-bordered w-full"
              />
            </label>

            {mode === "register" && (
              <label className="form-control w-full">
                <span className="label-text">Name</span>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  className="input input-bordered w-full"
                />
              </label>
            )}

            <label className="form-control w-full">
              <span className="label-text">Password</span>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="input input-bordered w-full"
              />
            </label>

            {error && <p className="text-error text-sm">{error}</p>}

            <button type="submit" disabled={isLoading} className="btn btn-primary w-full">
              {isLoading ? "Please wait..." : mode === "login" ? "Log in" : "Sign up"}
            </button>
          </form>

          <p className="text-sm mt-2">
            {mode === "login" ? "No account?" : "Already have one?"}{" "}
            <button
              onClick={() => {
                setMode(mode === "login" ? "register" : "login");
                setError("");
              }}
              className="btn btn-link btn-sm p-0"
            >
              {mode === "login" ? "Register" : "Log in"}
            </button>
          </p>
        </div>
      </div>
    </main>
  );
}
