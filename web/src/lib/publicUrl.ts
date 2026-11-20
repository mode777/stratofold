// Public pretty-URL resolution (design D6): the session-free resolver
// turns an /apps/<name> alias into the vdir id the filesystem API needs.
// Every failure stays an ApiFailure so the alias gate can render the
// explicit not-available state instead of a login prompt.

import { sfFetch } from "./filesApi";

// The server's name grammar (public-urls spec): 2–63 lowercase ASCII
// letters/digits/hyphens, alphanumeric at both ends.
const PUBLIC_SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

export function isValidPublicSlug(value: string): boolean {
  return value.length >= 2 && value.length <= 63 && PUBLIC_SLUG_PATTERN.test(value);
}

export function publicAliasPath(slug: string): string {
  return `/apps/${encodeURIComponent(slug)}`;
}

export type PublicAliasMeta = {
  vdir: string;
  name: string;
};

export async function fetchPublicAliasMeta(alias: string): Promise<PublicAliasMeta> {
  const resp = await sfFetch(`/api/sf/public-urls/${encodeURIComponent(alias)}`);
  const data = (await resp.json()) as { vdir?: string; name?: string };
  return { vdir: data.vdir ?? "", name: data.name ?? "" };
}
