// Public-vdir metadata (design D1): the single anonymous probe that
// decides whether an unauthenticated visitor may browse a vdir, and
// the name source that replaces the authenticated record API in
// public mode. Fail-closed: every non-200 maps into the deterministic
// failure classes, so a non-public or unknown vdir reads as not-found.

import { sfFetch } from "./filesApi";

export type PublicVdirMeta = {
  name: string;
  is_public: true;
};

// fetchPublicVdirMeta resolves one vdir's public metadata. Any
// failure (404 for non-public/unknown, network, server) propagates as
// an ApiFailure for the caller's failure states.
export async function fetchPublicVdirMeta(vdirId: string): Promise<PublicVdirMeta> {
  const resp = await sfFetch(`/api/sf/vdirs/${encodeURIComponent(vdirId)}/meta`);
  const data = (await resp.json()) as { name?: string };
  return { name: data.name ?? "", is_public: true };
}
