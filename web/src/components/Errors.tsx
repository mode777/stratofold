// Failure states (the error-class UI mapping, web-ui spec): each
// deterministic API class renders a distinct state; 503 offers an
// explicit retry action, 403 offers no repeating write attempt.

import type { ApiFailure } from "../lib/filesApi";

export function FailureState({
  failure,
  onRetry,
}: {
  failure: ApiFailure;
  onRetry?: () => void;
}) {
  switch (failure.kind) {
    case "notfound":
      return (
        <div role="alert" data-testid="state-notfound" className="p-6 text-center text-gray-600">
          <p className="text-lg font-medium text-gray-800">Not found</p>
          <p className="mt-1 text-sm">{failure.message}</p>
        </div>
      );
    case "forbidden":
      return (
        <div role="alert" data-testid="state-forbidden" className="p-6 text-center text-gray-600">
          <p className="text-lg font-medium text-gray-800">Forbidden</p>
          <p className="mt-1 text-sm">You don't have permission for this action.</p>
        </div>
      );
    case "retryable":
      return (
        <div role="alert" data-testid="state-retryable" className="p-6 text-center text-gray-600">
          <p className="text-lg font-medium text-gray-800">Temporarily unavailable</p>
          <p className="mt-1 text-sm">{failure.message}</p>
          {onRetry && (
            <button
              type="button"
              data-testid="action-retry"
              onClick={onRetry}
              className="mt-3 rounded border border-blue-600 px-3 py-1.5 text-sm text-blue-700 hover:bg-blue-50"
            >
              Retry
            </button>
          )}
        </div>
      );
    default:
      return (
        <div role="alert" data-testid="state-error" className="p-6 text-center text-gray-600">
          <p className="text-lg font-medium text-gray-800">Something went wrong</p>
          <p className="mt-1 text-sm">{failure.message}</p>
        </div>
      );
  }
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div data-testid="state-empty" className="p-6 text-center text-gray-600">
      <p className="text-lg font-medium text-gray-800">{title}</p>
      {hint && <p className="mt-1 text-sm">{hint}</p>}
    </div>
  );
}

export function Spinner({ label = "Loading…" }: { label?: string }) {
  return (
    <div role="status" className="p-6 text-center text-sm text-gray-500">
      {label}
    </div>
  );
}
