// Session lifecycle (design D3): the login screen posts to
// /api/sf/auth, which sets the HttpOnly sf_session cookie; the token
// from the same response is loaded into the PocketBase SDK auth store
// so record-API calls carry the Authorization header. On start a
// persisted store is validated with authRefresh; any 401 from any API
// call (via filesApi's interceptor hook) clears the store and routes
// back to login. Logout calls DELETE /api/sf/auth (server-side token
// rotation) and clears the store.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { RecordModel } from "pocketbase";
import { pb } from "./pb";
import { setUnauthorizedHandler } from "./filesApi";

export type SessionState = "checking" | "anonymous" | "authenticated";

export type Session = {
  state: SessionState;
  userId: string;
  userEmail: string;
  login: (identity: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
};

const SessionContext = createContext<Session | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SessionState>("checking");

  const clear = useCallback(() => {
    pb.authStore.clear();
    setState("anonymous");
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(clear);
    return () => setUnauthorizedHandler(null);
  }, [clear]);

  useEffect(() => {
    let cancelled = false;
    if (!pb.authStore.isValid) {
      setState("anonymous");
      return;
    }
    void (async () => {
      try {
        await pb.collection("users").authRefresh();
        if (!cancelled) setState("authenticated");
      } catch {
        pb.authStore.clear();
        if (!cancelled) setState("anonymous");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (identity: string, password: string) => {
    let resp: Response;
    try {
      resp = await fetch("/api/sf/auth", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identity, password }),
      });
    } catch {
      throw new Error("Network error — the login request never completed");
    }
    if (!resp.ok) {
      // Invalid credentials, unknown user, or a transient failure —
      // the login screen shows an error either way; the server keeps
      // unknown-user and wrong-password indistinguishable.
      throw new Error("Invalid credentials");
    }
    const data = (await resp.json()) as { token: string; record: RecordModel };
    pb.authStore.save(data.token, data.record);
    setState("authenticated");
  }, []);

  const logout = useCallback(async () => {
    try {
      await fetch("/api/sf/auth", { method: "DELETE", credentials: "same-origin" });
    } catch {
      // Best effort: the local credentials are dropped regardless, so
      // no further authenticated traffic leaves the app.
    }
    clear();
  }, [clear]);

  const value = useMemo<Session>(
    () => ({
      state,
      userId: (pb.authStore.record?.id as string | undefined) ?? "",
      userEmail: (pb.authStore.record?.email as string | undefined) ?? "",
      login,
      logout,
    }),
    [state, login, logout],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): Session {
  const session = useContext(SessionContext);
  if (!session) throw new Error("useSession outside SessionProvider");
  return session;
}
