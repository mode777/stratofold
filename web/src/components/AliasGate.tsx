// Pretty public URL gate (design D7): resolve /apps/<alias> once through
// the session-free resolver, then provide the same browse-route context
// the /v routes use with the alias as the navigation and file base. A
// miss shows the explicit not-available state — never the login screen,
// so an unknown, released, or un-published name cannot be distinguished.

import { useEffect, useState, type ReactNode } from "react";
import { useNavigate, useParams } from "react-router";
import { BrowseRouteProvider } from "../lib/browseRoute";
import { fetchPublicAliasMeta, type PublicAliasMeta } from "../lib/publicUrl";
import { useSession } from "../lib/session";
import { UnavailableState } from "./Errors";

export function AliasGate({ children }: { children: ReactNode }) {
  const { alias = "" } = useParams();
  const { state } = useSession();
  const navigate = useNavigate();
  const [meta, setMeta] = useState<PublicAliasMeta | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setMeta(null);
    setFailed(false);
    fetchPublicAliasMeta(alias)
      .then((resolved) => {
        if (!cancelled) setMeta(resolved);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [alias]);

  if (failed) {
    const signedIn = state === "authenticated";
    return (
      <UnavailableState
        actionLabel={signedIn ? "Back to files" : "Sign in"}
        onSignIn={() => void navigate(signedIn ? "/files" : "/")}
      />
    );
  }
  if (meta === null) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <span role="status" className="text-sm text-ios-secondary/60">
          Checking availability…
        </span>
      </div>
    );
  }

  const basePath = `/apps/${alias}`;
  return (
    <BrowseRouteProvider
      value={{
        vdirId: meta.vdir,
        basePath,
        fileBase: basePath,
        publicMode: true,
        publicName: meta.name,
      }}
    >
      {children}
    </BrowseRouteProvider>
  );
}
