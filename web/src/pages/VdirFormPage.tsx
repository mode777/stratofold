// Vdir form (web-ui spec): a full-height pushed screen for create/edit —
// name, root path, own-connection picker (with remote-dir default),
// public switch, sharing entry, and delete row.

import { useEffect, useState, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router";
import { useSession } from "../lib/session";
import {
  createVdir,
  deleteVdir,
  listConnections,
  listSharesForVdir,
  toApiFailure,
  updateVdir,
  type ConnectionRecord,
  type VdirRecord,
} from "../lib/records";
import { listVdirs } from "../lib/records";
import { Alert } from "../components/Dialog";
import { FailureState, Spinner } from "../components/Errors";
import { ChevronRightIcon, PeopleIcon } from "../components/icons";

export function VdirFormPage() {
  const { id = "new" } = useParams();
  const navigate = useNavigate();
  const { userId } = useSession();
  const isNew = id === "new";

  const [existing, setExisting] = useState<VdirRecord | null>(null);
  const [connections, setConnections] = useState<ConnectionRecord[] | null>(null);
  const [shareCount, setShareCount] = useState(0);
  const [loading, setLoading] = useState(!isNew);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const [name, setName] = useState("");
  const [rootPath, setRootPath] = useState("");
  const [connectionId, setConnectionId] = useState("");
  const [isPublic, setIsPublic] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void listConnections()
      .then((records) => {
        if (!cancelled) setConnections(records);
      })
      .catch(() => {
        if (!cancelled) setConnections([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (isNew) return;
    let cancelled = false;
    void listVdirs()
      .then((all) => {
        if (cancelled) return;
        const found = all.find((v) => v.id === id) ?? null;
        setExisting(found);
        if (found) {
          setName(found.name);
          setRootPath(found.root_path);
          setConnectionId(found.connection);
          setIsPublic(found.is_public);
        }
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });
    void listSharesForVdir(id)
      .then((shares) => {
        if (!cancelled) setShareCount(shares.length);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [id, isNew]);

  const back = () => void navigate("/settings/vdirs");

  const onConnectionChange = (cid: string) => {
    setConnectionId(cid);
    if (existing) return;
    const remoteDir = connections?.find((c) => c.id === cid)?.remote_dir;
    if (remoteDir) setRootPath(remoteDir);
  };

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const data: Record<string, unknown> = {
      name: name.trim(),
      root_path: rootPath.trim(),
      connection: connectionId,
      is_public: isPublic,
    };
    if (!existing) data.owner = userId;
    try {
      if (existing) await updateVdir(existing.id, data);
      else await createVdir(data);
      back();
    } catch (err) {
      setError(toApiFailure(err).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!existing) return;
    try {
      await deleteVdir(existing.id);
      back();
    } catch (err) {
      setError(toApiFailure(err).message);
      setConfirmDelete(false);
    }
  };

  if (loading) return <Spinner />;
  if (!isNew && !existing) return <FailureState failure={toApiFailure(new Error("Not found."))} />;

  return (
    <div data-testid="vdir-form" className="flex min-h-dvh flex-col">
      <div className="flex items-center justify-between border-b border-ios-separator bg-ios-card px-4 py-3">
        <button type="button" onClick={back} className="text-base text-ios-blue">
          Cancel
        </button>
        <h1 className="text-base font-bold text-ios-label">{existing ? "Edit Vdir" : "New Vdir"}</h1>
        <button
          type="submit"
          form="vdir-form-el"
          disabled={busy}
          data-testid="vdir-save"
          className="text-base font-bold text-ios-blue disabled:opacity-40"
        >
          {busy ? "Saving…" : "Save"}
        </button>
      </div>

      <form id="vdir-form-el" onSubmit={onSubmit} className="flex-1 space-y-5 px-4 py-3 pb-24">
        {error && (
          <p role="alert" className="rounded-xl bg-ios-red/10 p-3 text-sm text-ios-red">
            {error}
          </p>
        )}

        <section>
          <h2 className="px-2 py-1 text-xs font-semibold uppercase text-ios-secondary/60">Virtual Directory Details</h2>
          <div className="divide-y divide-ios-separator overflow-hidden rounded-2xl border border-black/5 bg-ios-card shadow-sm">
            <div className="flex items-center px-4 py-3">
              <label htmlFor="v-name" className="w-24 shrink-0 text-sm text-ios-secondary/80">
                Name
              </label>
              <input
                id="v-name"
                name="name"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="min-w-0 flex-1 bg-transparent text-sm font-medium text-ios-label outline-none"
              />
            </div>
            <div className="flex items-center px-4 py-3">
              <label htmlFor="v-root" className="w-24 shrink-0 text-sm text-ios-secondary/80">
                Root Path
              </label>
              <input
                id="v-root"
                name="root_path"
                required
                value={rootPath}
                onChange={(e) => setRootPath(e.target.value)}
                placeholder="/home/"
                className="min-w-0 flex-1 bg-transparent font-mono text-sm text-ios-label outline-none"
              />
            </div>
            <div className="flex items-center px-4 py-3">
              <label htmlFor="v-connection" className="w-24 shrink-0 text-sm text-ios-secondary/80">
                Connection
              </label>
              <select
                id="v-connection"
                name="connection"
                required
                value={connectionId}
                onChange={(e) => onConnectionChange(e.target.value)}
                data-testid="v-connection"
                className="min-w-0 flex-1 bg-transparent text-sm font-semibold text-ios-label outline-none"
              >
                <option value="" disabled>
                  {connections === null ? "Loading…" : connections.length === 0 ? "No own connections" : "Choose a connection"}
                </option>
                {(connections ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </section>

        <section className="rounded-2xl border border-black/5 bg-ios-card p-4 shadow-sm">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-base font-semibold text-ios-label">Public Access</span>
            <label className="relative inline-flex cursor-pointer items-center">
              <input
                type="checkbox"
                data-testid="v-public"
                checked={isPublic}
                onChange={(e) => setIsPublic(e.target.checked)}
                className="peer sr-only"
              />
              <span className="h-6 w-11 rounded-full bg-ios-separator after:absolute after:top-[2px] after:left-[2px] after:h-5 after:w-5 after:rounded-full after:bg-white after:shadow after:transition-all peer-checked:bg-ios-green peer-checked:after:translate-x-full" />
            </label>
          </div>
          <p className="text-xs leading-normal text-ios-secondary/60">
            Anyone with the link can browse and download. Never allows writing or modifying.
          </p>
        </section>

        {existing && (
          <button
            type="button"
            data-testid="vdir-sharing"
            onClick={() => void navigate(`/settings/vdirs/${existing.id}/sharing`)}
            className="flex w-full items-center gap-3 rounded-2xl border border-black/5 bg-ios-card px-4 py-3.5 text-left shadow-sm active:bg-ios-bg"
          >
            <PeopleIcon className="text-ios-blue" />
            <span className="flex-1 text-base font-semibold text-ios-label">Sharing &amp; Roles</span>
            <span className="rounded-full bg-ios-blue/10 px-2 py-0.5 text-xs font-bold text-ios-blue">
              {shareCount} people
            </span>
            <ChevronRightIcon className="text-xs text-ios-secondary/30" />
          </button>
        )}

        {existing && (
          <button
            type="button"
            data-testid="delete-vdir"
            onClick={() => setConfirmDelete(true)}
            className="w-full rounded-2xl border border-black/5 bg-ios-card px-4 py-3 text-left text-sm font-semibold text-ios-red shadow-sm"
          >
            Delete Virtual Directory
          </button>
        )}
      </form>

      {confirmDelete && existing && (
        <Alert
          title={`Delete “${existing.name}”?`}
          message="This cannot be undone."
          confirmLabel="Delete"
          destructive
          onCancel={() => setConfirmDelete(false)}
          onConfirm={() => void remove()}
          confirmTestid="delete-vdir-confirm"
        />
      )}
    </div>
  );
}
