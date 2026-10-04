// Vdir switcher (web-ui spec): own vdirs under "My vdirs", shares
// under "Shared with me", public vdirs marked; a user with no
// connections never sees anything connection-related.

import { Link, useNavigate } from "react-router";
import { useSession } from "../lib/session";
import { useVdirs } from "../lib/useVdirs";
import { FailureState, Spinner } from "./Errors";

export function VdirSwitcher({ onNavigate }: { onNavigate?: () => void }) {
  const { userId } = useSession();
  const { vdirs, failure, loading, reload } = useVdirs();

  if (loading) return <Spinner label="Loading vdirs…" />;
  if (failure) return <FailureState failure={failure} onRetry={reload} />;

  const own = vdirs.filter((v) => v.owner === userId);
  const shared = vdirs.filter((v) => v.owner !== userId);

  return (
    <nav data-testid="vdir-switcher" className="p-2 text-sm">
      <Group title="My vdirs" items={own} onNavigate={onNavigate} empty="No vdirs yet" />
      <Group
        title="Shared with me"
        items={shared}
        onNavigate={onNavigate}
        empty="Nothing shared with you"
      />
    </nav>
  );
}

function Group({
  title,
  items,
  onNavigate,
  empty,
}: {
  title: string;
  items: Array<{ id: string; name: string; is_public: boolean }>;
  onNavigate?: () => void;
  empty: string;
}) {
  const navigate = useNavigate();
  return (
    <div className="mb-3" data-testid={`group-${title.toLowerCase().replace(/\s+/g, "-")}`}>
      <p className="px-2 py-1 text-xs font-semibold uppercase tracking-wide text-gray-400">{title}</p>
      {items.length === 0 && <p className="px-2 py-1 text-gray-400">{empty}</p>}
      <ul>
        {items.map((v) => (
          <li key={v.id}>
            <button
              type="button"
              onClick={() => {
                onNavigate?.();
                void navigate(`/v/${v.id}`);
              }}
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-gray-100"
            >
              <span aria-hidden="true">📁</span>
              <span className="truncate">{v.name}</span>
              {v.is_public && (
                <span
                  data-testid="public-badge"
                  className="ml-auto rounded-full bg-green-50 px-2 py-0.5 text-xs text-green-700"
                >
                  public
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>
      {title === "My vdirs" && (
        <Link
          to="/vdirs"
          onClick={onNavigate}
          className="mt-1 inline-block px-2 py-1 text-xs text-blue-700 hover:underline"
        >
          Manage vdirs
        </Link>
      )}
    </div>
  );
}
