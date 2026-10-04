// Shared vdir enumeration hook: one list call, own/shared split left
// to consumers (the owner field is on the record).

import { useCallback, useEffect, useState } from "react";
import { listVdirs, toApiFailure, type VdirRecord } from "./records";
import type { ApiFailure } from "./filesApi";

export function useVdirs() {
  const [vdirs, setVdirs] = useState<VdirRecord[]>([]);
  const [failure, setFailure] = useState<ApiFailure | null>(null);
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void listVdirs()
      .then((records) => {
        if (!cancelled) {
          setVdirs(records);
          setFailure(null);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) setFailure(toApiFailure(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);

  return { vdirs, failure, loading, reload };
}
