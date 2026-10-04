// Grantee resolution for the share dialog (sharing-access-control
// delta): one exact email in, one {id, email} out — anything else the
// server already rejects; this wrapper just carries the failure
// classes through.

import { sfFetch } from "./filesApi";

export type LookupUser = { id: string; email: string };

export async function lookupUser(email: string): Promise<LookupUser> {
  const resp = await sfFetch(`/api/sf/users/lookup?email=${encodeURIComponent(email)}`);
  return (await resp.json()) as LookupUser;
}
