// Connections list (web-ui spec): saved SSH/SFTP endpoints; the "+"
// pushes the form. Rows push the form for edit/delete.

import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { listConnections, toApiFailure, type ConnectionRecord } from "../lib/records";
import { FailureState, Spinner } from "../components/Errors";
import { ChevronLeftIcon, ChevronRightIcon, PlusIcon } from "../components/icons";
import type { ApiFailure } from "../lib/filesApi";

export function ConnectionsPage() {
  const navigate = useNavigate();
  const [connections, setConnections] = useState<ConnectionRecord[]>([]);
  const [failure, setFailure] = useState<ApiFailure | null>(null);
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void listConnections()
      .then((records) => {
        if (!cancelled) {
          setConnections(records);
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

  return (
    <div data-testid="connections-page" className="flex min-h-dvh flex-col pb-24 md:pb-0">
      <div className="px-4 pt-1 pb-1">
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={() => void navigate("/settings")}
            className="flex items-center text-base text-ios-blue"
          >
            <ChevronLeftIcon className="mr-0.5 text-sm" /> Settings
          </button>
          <button
            type="button"
            data-testid="new-connection"
            aria-label="New connection"
            onClick={() => void navigate("/settings/connections/new")}
            className="text-ios-blue"
          >
            <PlusIcon className="text-lg" />
          </button>
        </div>
        <h1 className="mt-0.5 text-[34px] font-bold leading-tight tracking-tight text-ios-label">
          Connections
        </h1>
      </div>

      {loading ? (
        <Spinner />
      ) : failure ? (
        <FailureState failure={failure} onRetry={() => setAttempt((n) => n + 1)} />
      ) : connections.length === 0 ? (
        <p className="px-4 py-3 text-sm text-ios-secondary/50">
          No connections yet — create one to add vdirs.
        </p>
      ) : (
        <div className="mx-4 mt-2 divide-y divide-ios-separator overflow-hidden rounded-2xl border border-black/5 bg-ios-card shadow-sm">
          {connections.map((c) => (
            <button
              key={c.id}
              type="button"
              data-testid="connection-row"
              onClick={() => void navigate(`/settings/connections/${c.id}`)}
              className="flex w-full items-center gap-3 px-4 py-3.5 text-left active:bg-ios-bg"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-base font-semibold text-ios-label">{c.label}</span>
                <span className="block truncate font-mono text-xs text-ios-secondary/60">
                  {c.username}@{c.host}:{c.port} · {c.auth_method === "key" ? "Private key" : "Password"}
                  {c.remote_dir ? ` · ${c.remote_dir}` : ""}
                </span>
              </span>
              <ChevronRightIcon className="shrink-0 text-xs text-ios-secondary/30" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
