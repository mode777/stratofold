// Bulk file operations (design D5): compose the existing per-item
// filesystem API calls into a bounded-concurrency batch. Every item is
// attempted independently — one failure never stops the rest — and the
// returned outcomes keep the caller's input order. There is deliberately
// no server batch endpoint and no client-side retry: each mv/rm already
// carries the API's complete-or-nothing and reconnect guarantees.

import { ApiFailure, mv, rm } from "./filesApi";
import { joinPath } from "./listing";

export type BulkItem = { name: string; path: string };

export type BulkOutcome = BulkItem & { failure?: ApiFailure };

export type BulkOptions = {
  onProgress?: (processed: number, total: number) => void;
};

// BULK_CONCURRENCY caps in-flight requests so a select-all over a huge
// directory does not flood the server or the browser connection pool.
export const BULK_CONCURRENCY = 4;

function asFailure(err: unknown): ApiFailure {
  if (err instanceof ApiFailure) return err;
  const message = err instanceof Error ? err.message : "Request failed";
  return new ApiFailure("server", 0, message);
}

async function runBulk(
  items: BulkItem[],
  run: (item: BulkItem) => Promise<void>,
  { onProgress }: BulkOptions,
): Promise<BulkOutcome[]> {
  const outcomes = new Array<BulkOutcome | undefined>(items.length);
  let next = 0;
  let processed = 0;
  let stopped = false;

  const worker = async () => {
    while (!stopped) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      const item = items[index];

      let failure: ApiFailure | undefined;
      try {
        await run(item);
      } catch (err) {
        failure = asFailure(err);
        // A lost session ends the batch; the session interceptor sends
        // the user to sign-in. Requests already in flight still finish.
        if (failure.kind === "unauthorized") stopped = true;
      }

      outcomes[index] = failure ? { ...item, failure } : { ...item };
      processed += 1;
      onProgress?.(processed, items.length);
    }
  };

  const workers = Math.min(BULK_CONCURRENCY, items.length);
  await Promise.all(Array.from({ length: workers }, () => worker()));
  return outcomes.filter((outcome): outcome is BulkOutcome => outcome !== undefined);
}

export function bulkMove(
  vdirId: string,
  items: BulkItem[],
  destDir: string,
  options: BulkOptions = {},
): Promise<BulkOutcome[]> {
  return runBulk(items, (item) => mv(vdirId, item.path, joinPath(destDir, item.name)), options);
}

export function bulkDelete(
  vdirId: string,
  items: BulkItem[],
  options: BulkOptions = {},
): Promise<BulkOutcome[]> {
  return runBulk(items, (item) => rm(vdirId, item.path), options);
}
