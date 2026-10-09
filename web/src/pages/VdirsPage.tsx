// Virtual directories list (web-ui spec): the owner's own vdirs with
// public pills and remote paths; the "+" pushes the form.

import { useNavigate } from "react-router";
import { useSession } from "../lib/session";
import { useVdirs } from "../lib/useVdirs";
import { FailureState, Spinner } from "../components/Errors";
import { ChevronLeftIcon, ChevronRightIcon, FolderIcon, PlusIcon } from "../components/icons";

export function VdirsPage() {
  const { userId } = useSession();
  const { vdirs, failure, loading, reload } = useVdirs();
  const navigate = useNavigate();
  const own = vdirs.filter((v) => v.owner === userId);

  return (
    <div data-testid="vdirs-page" className="flex min-h-dvh flex-col">
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
            data-testid="new-vdir"
            aria-label="New vdir"
            onClick={() => void navigate("/settings/vdirs/new")}
            className="text-ios-blue"
          >
            <PlusIcon className="text-lg" />
          </button>
        </div>
        <h1 className="mt-0.5 text-[34px] font-bold leading-tight tracking-tight text-ios-label">
          Virtual Dirs
        </h1>
      </div>

      {loading ? (
        <Spinner />
      ) : failure ? (
        <FailureState failure={failure} onRetry={reload} />
      ) : own.length === 0 ? (
        <p className="px-4 py-3 text-sm text-ios-secondary/50">
          No vdirs yet — create one on one of your connections.
        </p>
      ) : (
        <div className="mx-4 mt-2 divide-y divide-ios-separator overflow-hidden rounded-2xl border border-black/5 bg-ios-card shadow-sm">
          {own.map((v) => (
            <button
              key={v.id}
              type="button"
              data-testid="vdir-row"
              onClick={() => void navigate(`/settings/vdirs/${v.id}`)}
              className="flex w-full items-center gap-3 px-4 py-3.5 text-left active:bg-ios-bg"
            >
              <FolderIcon className="text-lg text-ios-blue" />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <span className="truncate text-base font-semibold text-ios-label">{v.name}</span>
                  {v.is_public && (
                    <span className="rounded-full bg-ios-green/15 px-1.5 py-0.5 text-[10px] font-bold text-ios-green">
                      Public
                    </span>
                  )}
                </span>
                <span className="block truncate font-mono text-xs text-ios-secondary/60">{v.root_path}</span>
              </span>
              <ChevronRightIcon className="shrink-0 text-xs text-ios-secondary/30" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
