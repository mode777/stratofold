// Write-permission hook (design D4): resolves the signed-in user's
// effective role on one vdir so the browse view can gate its write
// affordances. The role is derived once per vdir, not per directory.

import { useEffect, useState } from "react";
import { canWrite, effectiveRoleForVdir, type EffectiveRole, type VdirRecord } from "./records";
import { useSession } from "./session";

export function useVdirRole(vdir: VdirRecord | null): { role: EffectiveRole; canWrite: boolean } {
  const { userId } = useSession();
  const [role, setRole] = useState<EffectiveRole>("none");

  useEffect(() => {
    let cancelled = false;
    if (!vdir) {
      setRole("none");
      return;
    }
    void effectiveRoleForVdir(vdir, userId)
      .then((resolved) => {
        if (!cancelled) setRole(resolved);
      })
      .catch(() => {
        // A failed role lookup falls back to read-only rather than
        // offering a write the server may reject.
        if (!cancelled) setRole("none");
      });
    return () => {
      cancelled = true;
    };
  }, [vdir, userId]);

  return { role, canWrite: canWrite(role) };
}
