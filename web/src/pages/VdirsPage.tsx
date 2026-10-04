// Vdirs management (web-ui spec): create/edit/delete over the record
// API — own connections only in the binding select, is_public toggle,
// and per-vdir share management for the owner.

import { useEffect, useState, type FormEvent } from "react";
import { useSession } from "../lib/session";
import {
  createVdir,
  deleteVdir,
  listConnections,
  toApiFailure,
  updateVdir,
  type ConnectionRecord,
  type VdirRecord,
} from "../lib/records";
import { useVdirs } from "../lib/useVdirs";
import { Dialog } from "../components/Dialog";
import { FailureState, Spinner } from "../components/Errors";
import { ShareDialog } from "../components/ShareDialog";

export function VdirsPage() {
  const { userId } = useSession();
  const { vdirs, failure, loading, reload } = useVdirs();
  const [connections, setConnections] = useState<ConnectionRecord[] | null>(null);
  const [editing, setEditing] = useState<VdirRecord | "new" | null>(null);
  const [sharing, setSharing] = useState<VdirRecord | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void listConnections()
      .then((records) => {
        if (!cancelled) setConnections(records);
      })
      .catch(() => {
        // The select surfaces "no connections" from an empty list.
        if (!cancelled) setConnections([]);
      });
    return () => {
      cancelled = true;
    };
  }, [editing]);

  const remove = async (id: string) => {
    setActionError(null);
    try {
      await deleteVdir(id);
      reload();
    } catch (err) {
      setActionError(toApiFailure(err).message);
    }
  };

  const own = vdirs.filter((v) => v.owner === userId);

  return (
    <div className="p-3" data-testid="vdirs-page">
      <div className="mb-3 flex items-center justify-between">
        <h1 className="text-lg font-semibold">Vdirs</h1>
        <button
          type="button"
          data-testid="new-vdir"
          onClick={() => setEditing("new")}
          className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
        >
          New vdir
        </button>
      </div>

      {actionError && (
        <p role="alert" className="mb-2 text-sm text-red-600">
          {actionError}
        </p>
      )}

      {loading ? (
        <Spinner />
      ) : failure ? (
        <FailureState failure={failure} onRetry={reload} />
      ) : own.length === 0 ? (
        <p className="text-sm text-gray-500">
          No vdirs yet — create one on one of your connections.
        </p>
      ) : (
        <ul className="divide-y divide-gray-100 rounded border border-gray-200">
          {own.map((v) => (
            <li key={v.id} className="flex items-center gap-3 px-3 py-2" data-testid="vdir-row">
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">
                  {v.name}
                  {v.is_public && (
                    <span className="ml-2 rounded-full bg-green-50 px-2 py-0.5 text-xs text-green-700">
                      public
                    </span>
                  )}
                </span>
                <span className="block truncate text-sm text-gray-500">{v.root_path}</span>
              </span>
              <button
                type="button"
                data-testid={`shares-vdir-${v.id}`}
                onClick={() => setSharing(v)}
                className="rounded border border-gray-300 px-2 py-1 text-xs hover:bg-gray-50"
              >
                Shares
              </button>
              <button
                type="button"
                onClick={() => setEditing(v)}
                className="rounded border border-gray-300 px-2 py-1 text-xs hover:bg-gray-50"
              >
                Edit
              </button>
              <button
                type="button"
                data-testid={`delete-vdir-${v.id}`}
                onClick={() => void remove(v.id)}
                className="rounded border border-red-200 px-2 py-1 text-xs text-red-700 hover:bg-red-50"
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}

      {editing && (
        <VdirForm
          existing={editing === "new" ? null : editing}
          connections={connections ?? []}
          connectionsLoading={connections === null}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            reload();
          }}
        />
      )}

      {sharing && (
        <ShareDialog
          vdir={sharing}
          onClose={() => setSharing(null)}
          onChanged={reload}
        />
      )}
    </div>
  );
}

const inputCls = "mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-600 focus:outline-none";

function VdirForm({
  existing,
  connections,
  connectionsLoading,
  onClose,
  onSaved,
}: {
  existing: VdirRecord | null;
  connections: ConnectionRecord[];
  connectionsLoading: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [isPublic, setIsPublic] = useState(existing?.is_public ?? false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Only the user's own connections are selectable — the API rule
  // rejects foreign bindings anyway; the UI never offers them.
  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const form = new FormData(e.currentTarget);
    const data: Record<string, unknown> = {
      name: String(form.get("name") ?? "").trim(),
      root_path: String(form.get("root_path") ?? "").trim(),
      connection: String(form.get("connection") ?? ""),
      is_public: isPublic,
    };
    try {
      if (existing) {
        await updateVdir(existing.id, data);
      } else {
        await createVdir(data);
      }
      onSaved();
    } catch (err) {
      setError(toApiFailure(err).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog title={existing ? "Edit vdir" : "New vdir"} onClose={onClose}>
      <form onSubmit={onSubmit} data-testid="vdir-form">
        <label htmlFor="v-name" className="block text-sm font-medium text-gray-700">
          Name
        </label>
        <input id="v-name" name="name" required defaultValue={existing?.name ?? ""} className={inputCls} />

        <label htmlFor="v-root" className="mt-3 block text-sm font-medium text-gray-700">
          Root path
        </label>
        <input id="v-root" name="root_path" required defaultValue={existing?.root_path ?? ""} className={inputCls} />

        <label htmlFor="v-connection" className="mt-3 block text-sm font-medium text-gray-700">
          Connection
        </label>
        <select
          id="v-connection"
          name="connection"
          required
          defaultValue={existing?.connection ?? ""}
          data-testid="v-connection"
          className={inputCls}
        >
          <option value="" disabled>
            {connectionsLoading ? "Loading…" : connections.length === 0 ? "No own connections" : "Choose a connection"}
          </option>
          {connections.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>

        <label className="mt-3 flex items-center gap-2 text-sm font-medium text-gray-700">
          <input
            type="checkbox"
            name="is_public"
            data-testid="v-public"
            checked={isPublic}
            onChange={(e) => setIsPublic(e.target.checked)}
          />
          Public (anonymous browse + download)
        </label>

        {error && (
          <p role="alert" className="mt-3 text-sm text-red-600">
            {error}
          </p>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded border border-gray-300 px-3 py-1.5 text-sm">
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy}
            data-testid="vdir-save"
            className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

