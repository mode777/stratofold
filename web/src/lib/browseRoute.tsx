// Browse-route context (design D7): one browse/preview implementation
// serves both the signed-in /v/<vdir-id> tree and the public
// /apps/<alias> tree. The provider carries the vdir id, the URL base
// for navigation, the direct-file base, and whether the presentation is
// the read-only public one.

import { createContext, useContext, type ReactNode } from "react";
import { useParams } from "react-router";

export type BrowseRoute = {
  vdirId: string;
  basePath: string;
  fileBase: string;
  publicMode: boolean;
  publicName: string | null;
};

export function browseRouteForVdir(vdirId: string): BrowseRoute {
  const id = encodeURIComponent(vdirId);
  return {
    vdirId,
    basePath: `/v/${id}`,
    fileBase: `/files/${id}`,
    publicMode: false,
    publicName: null,
  };
}

const BrowseRouteContext = createContext<BrowseRoute | null>(null);

export function BrowseRouteProvider({
  value,
  children,
}: {
  value: BrowseRoute;
  children: ReactNode;
}) {
  return <BrowseRouteContext.Provider value={value}>{children}</BrowseRouteContext.Provider>;
}

// VdirBrowseProvider supplies the signed-in /v/:vdirId route values.
// Public /v routes are supplied by PublicGate (publicMode + meta name);
// /apps routes by AliasGate.
export function VdirBrowseProvider({ children }: { children: ReactNode }) {
  const { vdirId = "" } = useParams();
  return (
    <BrowseRouteProvider value={browseRouteForVdir(vdirId)}>{children}</BrowseRouteProvider>
  );
}

// useBrowseRoute falls back to the /v/:vdirId shape so components
// rendered outside a provider (component tests, the move picker) keep
// their existing behavior.
export function useBrowseRoute(): BrowseRoute {
  const route = useContext(BrowseRouteContext);
  const { vdirId = "" } = useParams();
  return route ?? browseRouteForVdir(vdirId);
}
