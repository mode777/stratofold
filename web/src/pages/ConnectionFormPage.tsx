// Connection form (web-ui spec): a full-height pushed screen for
// create/edit. Secrets are write-only: the server never returns them,
// the form renders placeholders only, and an empty secret on edit is
// omitted so the stored value stays. The auth method is a segmented
// control; the host-key fingerprint carries the trust-on-first-use hint.

import { useEffect, useState, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router";
import {
  createConnection,
  deleteConnection,
  listConnections,
  toApiFailure,
  updateConnection,
  type ConnectionRecord,
} from "../lib/records";
import { useSession } from "../lib/session";
import { Alert } from "../components/Dialog";
import { FailureState, Spinner } from "../components/Errors";

const fieldRow = "flex items-center px-4 py-3";
const fieldLabel = "w-28 shrink-0 text-sm text-ios-secondary/80";
const fieldInput = "min-w-0 flex-1 bg-transparent text-sm text-ios-label outline-none";

export function ConnectionFormPage() {
  const { id = "new" } = useParams();
  const navigate = useNavigate();
  const { userId } = useSession();
  const isNew = id === "new";

  const [existing, setExisting] = useState<ConnectionRecord | null>(null);
  const [loading, setLoading] = useState(!isNew);
  const [authMethod, setAuthMethod] = useState<"password" | "key">("password");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (isNew) return;
    let cancelled = false;
    void listConnections()
      .then((records) => {
        if (cancelled) return;
        const found = records.find((r) => r.id === id) ?? null;
        setExisting(found);
        if (found) setAuthMethod(found.auth_method);
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id, isNew]);

  const back = () => void navigate("/settings/connections");

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const form = new FormData(e.currentTarget);
    const data: Record<string, unknown> = {
      label: String(form.get("label") ?? "").trim(),
      host: String(form.get("host") ?? "").trim(),
      port: Number(form.get("port") ?? 22) || 22,
      username: String(form.get("username") ?? "").trim(),
      auth_method: authMethod,
      host_key_fingerprint: String(form.get("host_key_fingerprint") ?? "").trim(),
      remote_dir: String(form.get("remote_dir") ?? "").trim(),
    };
    if (!existing) data.owner = userId;
    const password = String(form.get("password") ?? "");
    const privateKey = String(form.get("private_key") ?? "");
    const keyPassphrase = String(form.get("key_passphrase") ?? "");
    if (authMethod === "password") {
      if (password) data.password = password;
    } else {
      if (privateKey) data.private_key = privateKey;
      if (keyPassphrase) data.key_passphrase = keyPassphrase;
    }
    try {
      if (existing) await updateConnection(existing.id, data);
      else await createConnection(data);
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
      await deleteConnection(existing.id);
      back();
    } catch (err) {
      setError(toApiFailure(err).message);
      setConfirmDelete(false);
    }
  };

  if (loading) return <Spinner />;
  if (!isNew && !existing) return <FailureState failure={toApiFailure(new Error("Not found."))} />;

  return (
    <div data-testid="connection-form" className="flex min-h-dvh flex-col">
      <div className="flex items-center justify-between border-b border-ios-separator bg-ios-card px-4 py-3">
        <button type="button" onClick={back} className="text-base text-ios-blue">
          Cancel
        </button>
        <h1 className="text-base font-bold text-ios-label">
          {existing ? "Edit Connection" : "New Connection"}
        </h1>
        <button
          type="submit"
          form="connection-form-el"
          disabled={busy}
          data-testid="connection-save"
          className="text-base font-bold text-ios-blue disabled:opacity-40"
        >
          {busy ? "Saving…" : "Save"}
        </button>
      </div>

      <form id="connection-form-el" onSubmit={onSubmit} className="flex-1 space-y-5 px-4 py-3 pb-24">
        {error && (
          <p role="alert" className="rounded-xl bg-ios-red/10 p-3 text-sm text-ios-red">
            {error}
          </p>
        )}

        <section>
          <h2 className="px-2 py-1 text-xs font-semibold uppercase text-ios-secondary/60">Server</h2>
          <div className="divide-y divide-ios-separator overflow-hidden rounded-2xl border border-black/5 bg-ios-card shadow-sm">
            <div className={fieldRow}>
              <label htmlFor="c-label" className={fieldLabel}>
                Label
              </label>
              <input id="c-label" name="label" required defaultValue={existing?.label ?? ""} className={fieldInput} />
            </div>
            <div className={fieldRow}>
              <label htmlFor="c-host" className={fieldLabel}>
                Host
              </label>
              <input id="c-host" name="host" required defaultValue={existing?.host ?? ""} className={fieldInput} />
            </div>
            <div className={fieldRow}>
              <label htmlFor="c-port" className={fieldLabel}>
                Port
              </label>
              <input
                id="c-port"
                name="port"
                type="number"
                min={1}
                max={65535}
                defaultValue={existing?.port ?? 22}
                className={fieldInput}
              />
            </div>
            <div className={fieldRow}>
              <label htmlFor="c-username" className={fieldLabel}>
                Username
              </label>
              <input id="c-username" name="username" required defaultValue={existing?.username ?? ""} className={fieldInput} />
            </div>
          </div>
        </section>

        <section>
          <h2 className="px-2 py-1 text-xs font-semibold uppercase text-ios-secondary/60">Authentication</h2>
          <div className="space-y-3 rounded-2xl border border-black/5 bg-ios-card p-3 shadow-sm">
            <div className="flex rounded-lg bg-ios-separator p-0.5 text-xs font-medium">
              <button
                type="button"
                data-testid="c-auth-password"
                onClick={() => setAuthMethod("password")}
                className={`flex-1 rounded-md py-1.5 ${authMethod === "password" ? "bg-ios-card font-semibold text-ios-label shadow-sm" : "text-ios-secondary/70"}`}
              >
                Password
              </button>
              <button
                type="button"
                data-testid="c-auth-key"
                onClick={() => setAuthMethod("key")}
                className={`flex-1 rounded-md py-1.5 ${authMethod === "key" ? "bg-ios-card font-semibold text-ios-label shadow-sm" : "text-ios-secondary/70"}`}
              >
                Private Key
              </button>
            </div>

            {authMethod === "password" ? (
              <div>
                <label htmlFor="c-password" className="mb-1 block text-xs text-ios-secondary/60">
                  Password {existing && <span className="text-ios-secondary/40">(leave empty to keep stored)</span>}
                </label>
                <input
                  id="c-password"
                  name="password"
                  type="password"
                  autoComplete="new-password"
                  placeholder={existing ? "••••••••" : ""}
                  className="w-full rounded-lg border border-ios-separator bg-ios-bg px-3 py-2 text-sm outline-none"
                />
              </div>
            ) : (
              <>
                <div>
                  <label htmlFor="c-key" className="mb-1 block text-xs text-ios-secondary/60">
                    Private Key (OpenSSH / PEM){" "}
                    {existing && <span className="text-ios-secondary/40">(leave empty to keep stored)</span>}
                  </label>
                  <textarea
                    id="c-key"
                    name="private_key"
                    rows={3}
                    placeholder={existing ? "••••••••" : "-----BEGIN OPENSSH PRIVATE KEY-----"}
                    className="w-full rounded-lg border border-ios-separator bg-ios-bg p-2 font-mono text-xs outline-none"
                  />
                </div>
                <div>
                  <label htmlFor="c-passphrase" className="mb-1 block text-xs text-ios-secondary/60">
                    Key Passphrase {existing && <span className="text-ios-secondary/40">(leave empty to keep stored)</span>}
                  </label>
                  <input
                    id="c-passphrase"
                    name="key_passphrase"
                    type="password"
                    autoComplete="new-password"
                    placeholder={existing ? "••••••••" : ""}
                    className="w-full rounded-lg border border-ios-separator bg-ios-bg px-3 py-2 text-sm outline-none"
                  />
                </div>
              </>
            )}
          </div>
        </section>

        <section>
          <h2 className="px-2 py-1 text-xs font-semibold uppercase text-ios-secondary/60">Security</h2>
          <div className="rounded-2xl border border-black/5 bg-ios-card p-3 shadow-sm">
            <label htmlFor="c-fingerprint" className="mb-1 block text-xs text-ios-secondary/60">
              Host key fingerprint (optional)
            </label>
            <input
              id="c-fingerprint"
              name="host_key_fingerprint"
              defaultValue={existing?.host_key_fingerprint ?? ""}
              className="w-full rounded-lg border border-ios-separator bg-ios-bg px-3 py-2 font-mono text-sm outline-none"
            />
            <p className="mt-1 text-[11px] text-ios-secondary/50">
              Leave empty to pin the host key on the first successful connection (trust on first use).
            </p>
          </div>
        </section>

        <section>
          <h2 className="px-2 py-1 text-xs font-semibold uppercase text-ios-secondary/60">Defaults</h2>
          <div className="rounded-2xl border border-black/5 bg-ios-card p-3 shadow-sm">
            <label htmlFor="c-remote-dir" className="mb-1 block text-xs text-ios-secondary/60">
              Remote directory
            </label>
            <input
              id="c-remote-dir"
              name="remote_dir"
              placeholder="/home/"
              defaultValue={existing?.remote_dir ?? ""}
              className="w-full rounded-lg border border-ios-separator bg-ios-bg px-3 py-2 font-mono text-sm outline-none"
            />
            <p className="mt-1 text-[11px] text-ios-secondary/50">
              Default root path offered when creating a vdir on this connection.
            </p>
          </div>
        </section>

        {existing && (
          <button
            type="button"
            data-testid="delete-connection"
            onClick={() => setConfirmDelete(true)}
            className="w-full rounded-2xl border border-black/5 bg-ios-card px-4 py-3 text-left text-sm font-semibold text-ios-red shadow-sm"
          >
            Delete Connection
          </button>
        )}
      </form>

      {confirmDelete && existing && (
        <Alert
          title={`Delete “${existing.label}”?`}
          message="Its vdirs will be removed too. This cannot be undone."
          confirmLabel="Delete"
          destructive
          onCancel={() => setConfirmDelete(false)}
          onConfirm={() => void remove()}
          confirmTestid="delete-connection-confirm"
        />
      )}
    </div>
  );
}
