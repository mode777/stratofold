// Dismissible bulk result notice (design D8): successful items are
// already reflected in the listing, so this reports only the failures
// that remain. Names are bounded to a small sample and mapped to the
// same error vocabulary the full-page failure states use.

import type { ApiFailure } from "../lib/filesApi";
import type { BulkOutcome } from "../lib/bulkOps";

const SAMPLE_SIZE = 5;

export function failureLabel(failure: ApiFailure): string {
  switch (failure.kind) {
    case "notfound":
      return "not found";
    case "forbidden":
      return "permission denied";
    case "retryable":
      return "temporarily unavailable";
    case "unauthorized":
      return "signed out";
    case "rejected":
      return "rejected";
    default:
      return "server error";
  }
}

export function BulkResultNotice({
  action,
  outcomes,
  onDismiss,
}: {
  action: "move" | "delete";
  outcomes: BulkOutcome[];
  onDismiss: () => void;
}) {
  const failures = outcomes.flatMap((outcome) =>
    outcome.failure ? [{ ...outcome, failure: outcome.failure }] : [],
  );
  if (failures.length === 0) return null;

  const verb = action === "move" ? "Moved" : "Deleted";
  const sample = failures.slice(0, SAMPLE_SIZE);
  const remaining = failures.length - sample.length;

  return (
    <div
      role="alert"
      data-testid="bulk-result"
      className="mx-4 mt-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p data-testid="bulk-result-summary" className="font-semibold">
            {verb} {outcomes.length - failures.length} of {outcomes.length}{" "}
            {outcomes.length === 1 ? "item" : "items"}. {failures.length} failed.
          </p>
          <ul className="mt-1 list-disc pl-4">
            {sample.map((outcome) => (
              <li key={outcome.path} data-testid="bulk-result-failure">
                {outcome.name} ({failureLabel(outcome.failure)})
              </li>
            ))}
          </ul>
          {remaining > 0 && <p className="mt-1">and {remaining} more</p>}
        </div>
        <button
          type="button"
          data-testid="bulk-result-dismiss"
          aria-label="Dismiss result"
          onClick={onDismiss}
          className="shrink-0 rounded p-1 font-semibold text-ios-blue hover:bg-black/5"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}
