// Files tab root (web-ui spec): the signed-in user's own vdirs under
// "My vdirs" and shares under "Shared with me", public marked, with a
// "Manage vdirs" link. Selecting a vdir pushes the browse view.

import { Link, useNavigate } from "react-router";
import { useSession } from "../lib/session";
import { useVdirs } from "../lib/useVdirs";
import { FailureState, Spinner } from "../components/Errors";
import { ChevronRightIcon, FolderIcon, PeopleIcon } from "../components/icons";
import type { VdirRecord } from "../lib/records";

function VdirRow({ vdir, shared }: { vdir: VdirRecord; shared: boolean }) {
  const navigate = useNavigate();
  return (
    <button
      type="button"
      data-testid="vdir-row"
      onClick={() => void navigate(`/v/${vdir.id}`)}
      className="flex w-full items-center gap-3 px-4 py-3.5 text-left active:bg-ios-bg"
    >
      <span
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-base ${
          shared ? "bg-indigo-50 text-indigo-600" : "bg-ios-blue/10 text-ios-blue"
        }`}
      >
        {shared ? <PeopleIcon /> : <FolderIcon />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate text-base font-semibold text-ios-label">{vdir.name}</span>
          {vdir.is_public && (
            <span
              data-testid="public-badge"
              className="rounded-full bg-ios-green/15 px-1.5 py-0.5 text-[10px] font-bold text-ios-green"
            >
              Public
            </span>
          )}
        </span>
        <span className="block truncate text-xs text-ios-secondary/60">
          {vdir.root_path}
        </span>
      </span>
      <ChevronRightIcon className="shrink-0 text-xs text-ios-secondary/30" />
    </button>
  );
}

export function LocationsPage() {
  const { userId } = useSession();
  const { vdirs, failure, loading, reload } = useVdirs();

  const own = vdirs.filter((v) => v.owner === userId);
  const shared = vdirs.filter((v) => v.owner !== userId);

  return (
    <div data-testid="locations" className="flex min-h-dvh flex-col">
      <div className="px-5 pt-3 pb-2">
        <h1 className="text-[34px] font-bold leading-tight tracking-tight text-ios-label">Files</h1>
      </div>

      {loading ? (
        <Spinner label="Loading vdirs…" />
      ) : failure ? (
        <FailureState failure={failure} onRetry={reload} />
      ) : (
        <div className="flex-1 px-4 pb-24">
          <section data-testid="group-my-vdirs" className="mb-6">
            <h2 className="px-2 py-1 text-xs font-semibold uppercase tracking-wider text-ios-secondary/60">
              My vdirs
            </h2>
            {own.length === 0 ? (
              <p className="px-2 py-1 text-sm text-ios-secondary/50">No vdirs yet</p>
            ) : (
              <div className="divide-y divide-ios-separator overflow-hidden rounded-2xl border border-black/5 bg-ios-card shadow-sm">
                {own.map((v) => (
                  <VdirRow key={v.id} vdir={v} shared={false} />
                ))}
              </div>
            )}
          </section>

          <section data-testid="group-shared-with-me" className="mb-4">
            <h2 className="px-2 py-1 text-xs font-semibold uppercase tracking-wider text-ios-secondary/60">
              Shared with me
            </h2>
            {shared.length === 0 ? (
              <p className="px-2 py-1 text-sm text-ios-secondary/50">Nothing shared with you</p>
            ) : (
              <div className="divide-y divide-ios-separator overflow-hidden rounded-2xl border border-black/5 bg-ios-card shadow-sm">
                {shared.map((v) => (
                  <VdirRow key={v.id} vdir={v} shared />
                ))}
              </div>
            )}
          </section>

          <div className="py-2 text-center">
            <Link to="/settings/vdirs" className="text-sm font-medium text-ios-blue hover:underline">
              Manage vdirs
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
