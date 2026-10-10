// Public gate (design D1): the anonymous exception to the login gate.
// For an unauthenticated visitor it probes the vdir's public metadata
// once: a public vdir renders the wrapped browse UI in public mode
// (the vdir's name travels through the context below), while a
// non-public or unknown vdir — or any probe failure — renders the
// login screen, fail-closed. Signed-in sessions pass straight through
// and the context stays null, so nothing about the signed-in flows
// changes.

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useParams } from "react-router";
import { fetchPublicVdirMeta } from "../lib/publicVdir";
import { useSession } from "../lib/session";
import { LoginPage } from "../pages/LoginPage";
import { Spinner } from "./Errors";

// The vdir's name in public mode, null when not in public mode
// (signed-in browsing keeps using the record API for identity/role).
const PublicBrowseContext = createContext<string | null>(null);

export function usePublicBrowseName(): string | null {
  return useContext(PublicBrowseContext);
}

export function PublicGate({ children }: { children: ReactNode }) {
  const { state } = useSession();
  const { vdirId = "" } = useParams();
  const [name, setName] = useState<string | null>(null);
  const [closed, setClosed] = useState(false);

  const anonymous = state === "anonymous";
  useEffect(() => {
    if (!anonymous) return;
    let cancelled = false;
    setName(null);
    setClosed(false);
    fetchPublicVdirMeta(vdirId)
      .then((meta) => {
        if (!cancelled) setName(meta.name);
      })
      .catch(() => {
        if (!cancelled) setClosed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [anonymous, vdirId]);

  if (!anonymous) return <>{children}</>;
  if (closed) return <LoginPage />;
  if (name === null) return <Spinner label="Checking availability…" />;
  return <PublicBrowseContext.Provider value={name}>{children}</PublicBrowseContext.Provider>;
}
