// Public gate (design D1): the anonymous exception to the login gate.
// For an unauthenticated visitor it probes the vdir's public metadata
// once: a public vdir renders the wrapped browse UI in public mode (the
// vdir's name travels through the browse-route context), while a
// non-public or unknown vdir — or any probe failure — renders the login
// screen, fail-closed. Signed-in sessions pass straight through and the
// context stays the normal /v route shape, so nothing about the
// signed-in flows changes.

import { useEffect, useState, type ReactNode } from "react";
import { useParams } from "react-router";
import { BrowseRouteProvider, browseRouteForVdir } from "../lib/browseRoute";
import { fetchPublicVdirMeta } from "../lib/publicVdir";
import { useSession } from "../lib/session";
import { LoginPage } from "../pages/LoginPage";
import { Spinner } from "./Errors";

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

  return (
    <BrowseRouteProvider
      value={{ ...browseRouteForVdir(vdirId), publicMode: true, publicName: name }}
    >
      {children}
    </BrowseRouteProvider>
  );
}
