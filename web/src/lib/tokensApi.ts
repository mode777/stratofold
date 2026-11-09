// Typed wrappers over the session-only /api/sf/tokens management
// routes (vdir-access-tokens capability). The plaintext token appears
// only in a mint response; list/revoke never carry it. Failures reuse
// sfFetch's deterministic ApiFailure classes.

import { ApiFailure, sfFetch } from "./filesApi";

export type TokenRole = "viewer" | "editor";

export type VdirToken = {
  id: string;
  name: string;
  vdir: string;
  vdir_name: string;
  role: TokenRole;
  token_hint: string;
  expires_at: string | null;
  last_used_at: string | null;
  created: string;
};

export type MintedToken = VdirToken & { token: string };

export type MintTokenInput = {
  vdir: string;
  name: string;
  role: TokenRole;
  expires_at?: string;
};

export async function listTokens(): Promise<VdirToken[]> {
  const resp = await sfFetch("/api/sf/tokens");
  const data = (await resp.json()) as { tokens?: VdirToken[] };
  return data.tokens ?? [];
}

export async function mintToken(input: MintTokenInput): Promise<MintedToken> {
  const resp = await sfFetch("/api/sf/tokens", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const data = (await resp.json()) as Partial<MintedToken>;
  if (!data.token || !data.id || !data.name || !data.vdir || !data.role) {
    throw new ApiFailure("server", resp.status, "Invalid token response");
  }
  return data as MintedToken;
}

export async function revokeToken(id: string): Promise<void> {
  await sfFetch(`/api/sf/tokens/${encodeURIComponent(id)}`, { method: "DELETE" });
}
