// Record-API access (PocketBase SDK, design D4): typed shapes for the
// collections the SPA manages plus the shared error mapping. The
// server's API rules enforce ownership; this layer only carries the
// deterministic error classes into the UI's failure states, routing
// 401s through the same interceptor as the /api/sf wrappers.

import { ClientResponseError } from "pocketbase";
import { ApiFailure, failureFor } from "./filesApi";
import { pb } from "./pb";

export type VdirRecord = {
  id: string;
  owner: string;
  name: string;
  root_path: string;
  is_public: boolean;
  connection: string;
};

export type ConnectionRecord = {
  id: string;
  label: string;
  host: string;
  port: number;
  username: string;
  auth_method: "password" | "key";
  // Optional: when absent the host key is pinned on first successful
  // connection (trust on first use).
  host_key_fingerprint?: string;
  // Default base directory for new vdirs on this connection.
  remote_dir?: string;
};

export type ShareRecord = {
  id: string;
  vdir: string;
  user: string;
  role: "viewer" | "editor";
};

export function toApiFailure(err: unknown): ApiFailure {
  if (err instanceof ApiFailure) return err;
  const status = err instanceof ClientResponseError ? err.status : 0;
  const message = err instanceof Error ? err.message : "Request failed";
  return failureFor(status, message);
}

export async function listVdirs(): Promise<VdirRecord[]> {
  try {
    // requestKey: null disables the SDK's auto-cancellation: several
    // components list vdirs concurrently (switcher, home redirect,
    // browse breadcrumbs) and must not abort each other.
    return await pb.collection("vdirs").getFullList<VdirRecord>({ sort: "name", requestKey: null });
  } catch (err) {
    throw toApiFailure(err);
  }
}

export async function listConnections(): Promise<ConnectionRecord[]> {
  try {
    return await pb.collection("connections").getFullList<ConnectionRecord>({ sort: "label", requestKey: null });
  } catch (err) {
    throw toApiFailure(err);
  }
}

export async function createConnection(data: Record<string, unknown>): Promise<void> {
  try {
    await pb.collection("connections").create(data);
  } catch (err) {
    throw toApiFailure(err);
  }
}

export async function updateConnection(id: string, data: Record<string, unknown>): Promise<void> {
  try {
    await pb.collection("connections").update(id, data);
  } catch (err) {
    throw toApiFailure(err);
  }
}

export async function deleteConnection(id: string): Promise<void> {
  try {
    await pb.collection("connections").delete(id);
  } catch (err) {
    throw toApiFailure(err);
  }
}

export async function createVdir(data: Record<string, unknown>): Promise<void> {
  try {
    await pb.collection("vdirs").create(data);
  } catch (err) {
    throw toApiFailure(err);
  }
}

export async function updateVdir(id: string, data: Record<string, unknown>): Promise<void> {
  try {
    await pb.collection("vdirs").update(id, data);
  } catch (err) {
    throw toApiFailure(err);
  }
}

export async function deleteVdir(id: string): Promise<void> {
  try {
    await pb.collection("vdirs").delete(id);
  } catch (err) {
    throw toApiFailure(err);
  }
}

// listSharesForVdir lists the shares on one (own) vdir — the read rule
// grants the vdir's owner. The grantee email is not expandable (the
// users view rule hides other records), so the UI resolves emails at
// grant time and otherwise shows the relation id.
export async function listSharesForVdir(vdirId: string): Promise<ShareRecord[]> {
  try {
    return await pb.collection("vdir_shares").getFullList<ShareRecord>({
      filter: pb.filter("vdir = {:vdir}", { vdir: vdirId }),
      requestKey: null,
    });
  } catch (err) {
    throw toApiFailure(err);
  }
}

export async function createShare(data: Record<string, unknown>): Promise<void> {
  try {
    await pb.collection("vdir_shares").create(data);
  } catch (err) {
    throw toApiFailure(err);
  }
}

export async function updateShare(id: string, data: Record<string, unknown>): Promise<void> {
  try {
    await pb.collection("vdir_shares").update(id, data);
  } catch (err) {
    throw toApiFailure(err);
  }
}

export async function deleteShare(id: string): Promise<void> {
  try {
    await pb.collection("vdir_shares").delete(id);
  } catch (err) {
    throw toApiFailure(err);
  }
}

// EffectiveRole is the signed-in user's standing on one vdir, derived
// client-side (design D4): the owner field decides ownership, otherwise
// the user's own share (the share read rule exposes it) decides editor
// vs viewer vs none. The server independently enforces the same
// boundary; this only drives which affordances are offered.
export type EffectiveRole = "owner" | "editor" | "viewer" | "none";

export function canWrite(role: EffectiveRole): boolean {
  return role === "owner" || role === "editor";
}

export async function effectiveRoleForVdir(
  vdir: VdirRecord,
  userId: string,
): Promise<EffectiveRole> {
  if (vdir.owner === userId) return "owner";
  if (!userId) return "none";
  try {
    const shares = await pb.collection("vdir_shares").getFullList<ShareRecord>({
      filter: pb.filter("vdir = {:vdir} && user = {:user}", { vdir: vdir.id, user: userId }),
      requestKey: null,
    });
    const role = shares[0]?.role;
    return role === "editor" ? "editor" : role === "viewer" ? "viewer" : "none";
  } catch (err) {
    throw toApiFailure(err);
  }
}
