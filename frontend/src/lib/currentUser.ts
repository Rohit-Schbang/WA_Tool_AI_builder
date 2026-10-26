"use client";

import { useEffect, useState } from "react";
import { api } from "./api";
import { getToken } from "./auth";

export interface CurrentUser {
  id: string;
  email: string;
  name: string | null;
  // UI hint only — the backend enforces Settings access on every request.
  canAccessSettings: boolean;
}

// One /api/auth/me request per token, shared by every component on the page.
let cache: { token: string; promise: Promise<CurrentUser | null> } | null = null;

export function fetchCurrentUser(): Promise<CurrentUser | null> {
  const token = getToken();
  if (!token) return Promise.resolve(null);
  if (cache?.token !== token) {
    const promise = api
      .get<CurrentUser>("/api/auth/me")
      .then((res) => res.data)
      .catch(() => {
        cache = null; // let the next caller retry (e.g. server was waking up)
        return null;
      });
    cache = { token, promise };
  }
  return cache.promise;
}

// `undefined` while loading, `null` if signed out / failed.
export function useCurrentUser(): CurrentUser | null | undefined {
  const [user, setUser] = useState<CurrentUser | null | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    fetchCurrentUser().then((u) => alive && setUser(u));
    return () => {
      alive = false;
    };
  }, []);
  return user;
}
