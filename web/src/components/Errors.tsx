// Failure/empty/loading states (web-ui spec): each deterministic API
// error class renders a distinct iOS state; only the retryable class
// offers a retry action, and forbidden offers no repeating write.

import type { ReactNode } from "react";
import type { ApiFailure } from "../lib/filesApi";
import type { ReactElement } from "react";
import { DocIcon, LockIcon, WarningIcon, WifiIcon, type IconProps } from "./icons";

function StateBlock({
  testid,
  Icon,
  tone,
  title,
  message,
  action,
}: {
  testid: string;
  Icon: (p: IconProps) => ReactElement;
  tone: string;
  title: string;
  message?: string;
  action?: ReactNode;
}) {
  return (
    <div
      role="alert"
      data-testid={testid}
      className="flex flex-col items-center justify-center px-6 py-12 text-center"
    >
      <div className={`mb-4 flex h-20 w-20 items-center justify-center rounded-3xl text-3xl ${tone}`}>
        <Icon />
      </div>
      <p className="text-xl font-bold text-ios-label">{title}</p>
      {message && <p className="mt-2 max-w-xs text-sm text-ios-secondary/70">{message}</p>}
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}

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
        <StateBlock
          testid="state-notfound"
          Icon={DocIcon}
          tone="bg-ios-blue/10 text-ios-blue"
          title="Not found"
          message={failure.message}
        />
      );
    case "forbidden":
      return (
        <StateBlock
          testid="state-forbidden"
          Icon={LockIcon}
          tone="bg-ios-red/10 text-ios-red"
          title="Permission denied"
          message="You don't have permission for this action."
        />
      );
    case "retryable":
      return (
        <StateBlock
          testid="state-retryable"
          Icon={WifiIcon}
          tone="bg-amber-100 text-amber-600"
          title="Temporarily unavailable"
          message={failure.message}
          action={
            onRetry && (
              <button
                type="button"
                data-testid="action-retry"
                onClick={onRetry}
                className="rounded-xl bg-ios-blue px-6 py-3 font-semibold text-white shadow-sm active:scale-95"
              >
                Retry
              </button>
            )
          }
        />
      );
    default:
      return (
        <StateBlock
          testid="state-error"
          Icon={WarningIcon}
          tone="bg-ios-secondary/10 text-ios-secondary"
          title="Something went wrong"
          message={failure.message}
        />
      );
  }
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div data-testid="state-empty" className="flex flex-col items-center px-6 py-12 text-center">
      <div className="mb-4 flex h-20 w-20 items-center justify-center rounded-3xl bg-ios-blue/10 text-ios-blue">
        <DocIcon className="text-3xl" />
      </div>
      <p className="text-lg font-semibold text-ios-label">{title}</p>
      {hint && <p className="mt-1 max-w-xs text-sm text-ios-secondary/70">{hint}</p>}
    </div>
  );
}

// UnavailableState is the anonymous browsing counterpart of the
// failure states (web-ui public-browsing spec): the vdir stopped
// being public (or the path vanished) — never a silent failure, never
// an unexplained error; the sign-in affordance is the way back in.
export function UnavailableState({ onSignIn }: { onSignIn: () => void }) {
  return (
    <StateBlock
      testid="state-unavailable"
      Icon={LockIcon}
      tone="bg-ios-secondary/10 text-ios-secondary"
      title="This content isn't available"
      message="It may no longer be shared publicly."
      action={
        <button
          type="button"
          data-testid="action-signin"
          onClick={onSignIn}
          className="rounded-xl bg-ios-blue px-6 py-3 font-semibold text-white shadow-sm active:scale-95"
        >
          Sign in
        </button>
      }
    />
  );
}

export function Spinner({ label = "Loading…" }: { label?: string }) {
  return (
    <div role="status" className="p-6 text-center text-sm text-ios-secondary/60">
      {label}
    </div>
  );
}
