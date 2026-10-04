// Connections management (web-ui spec): create/edit/delete over the
// record API. Secrets are write-only: the server never returns them
// (connreg strips the fields), the form renders placeholders only,
// and an empty secret on edit is omitted so the stored value stays.

import { useEffect, useState, type FormEvent } from "react";
import {
  createConnection,
  deleteConnection,
  listConnections,
  toApiFailure,
  updateConnection,
  type ConnectionRecord,
} from "../lib/records";
import { Dialog } from "../components/Dialog";
import { FailureState, Spinner } from "../components/Errors";
import type { ApiFailure } from "../lib/filesApi";

export function ConnectionsPage() {
  const [connections, setConnections] = useState<ConnectionRecord[]>([]);
  const [failure, setFailure] = useState<ApiFailure | null>(null);
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const [editing, setEditing] = useState<ConnectionRecord | "new" | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const reload = () => setAttempt((n) => n + 1);

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

  const remove = async (id: string) => {
    setActionError(null);
    try {
      await deleteConnection(id);
      reload();
    } catch (err) {
      setActionError(toApiFailure(err).message);
    }
  };

  return (
    <div className="p-3" data-testid="connections-page">
      <div className="mb-3 flex items-center justify-between">
        <h1 className="text-lg font-semibold">Connections</h1>
        <button
          type="button"
          data-testid="new-connection"
          onClick={() => setEditing("new")}
          className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
        >
          New connection
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
      ) : connections.length === 0 ? (
        <p className="text-sm text-gray-500">No connections yet — create one to add vdirs.</p>
      ) : (
        <ul className="divide-y divide-gray-100 rounded border border-gray-200">
          {connections.map((c) => (
            <li key={c.id} className="flex items-center gap-3 px-3 py-2" data-testid="connection-row">
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{c.label}</span>
                <span className="block truncate text-sm text-gray-500">
                  {c.username}@{c.host}:{c.port} · {c.auth_method}
                </span>
              </span>
              <button
                type="button"
                onClick={() => setEditing(c)}
                className="rounded border border-gray-300 px-2 py-1 text-xs hover:bg-gray-50"
              >
                Edit
              </button>
              <button
                type="button"
                data-testid={`delete-connection-${c.id}`}
                onClick={() => void remove(c.id)}
                className="rounded border border-red-200 px-2 py-1 text-xs text-red-700 hover:bg-red-50"
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}

      {editing && (
        <ConnectionForm
          existing={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            reload();
          }}
        />
      )}
    </div>
  );
}

const inputCls = "mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-600 focus:outline-none";

function ConnectionForm({
  existing,
  onClose,
  onSaved,
}: {
  existing: ConnectionRecord | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [authMethod, setAuthMethod] = useState<"password" | "key">(existing?.auth_method ?? "password");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Secrets are never initialized from `existing` — they are absent
  // from every API response; the fields are placeholders only.
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
    };
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
      if (existing) {
        await updateConnection(existing.id, data);
      } else {
        await createConnection(data);
      }
      onSaved();
    } catch (err) {
      setError(toApiFailure(err).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog title={existing ? "Edit connection" : "New connection"} onClose={onClose}>
      <form onSubmit={onSubmit} data-testid="connection-form">
        <label htmlFor="c-label" className="block text-sm font-medium text-gray-700">
          Label
        </label>
        <input id="c-label" name="label" required defaultValue={existing?.label ?? ""} className={inputCls} />

        <label htmlFor="c-host" className="mt-3 block text-sm font-medium text-gray-700">
          Host
        </label>
        <input id="c-host" name="host" required defaultValue={existing?.host ?? ""} className={inputCls} />

        <label htmlFor="c-port" className="mt-3 block text-sm font-medium text-gray-700">
          Port
        </label>
        <input
          id="c-port"
          name="port"
          type="number"
          min={1}
          max={65535}
          defaultValue={existing?.port ?? 22}
          className={inputCls}
        />

        <label htmlFor="c-username" className="mt-3 block text-sm font-medium text-gray-700">
          Username
        </label>
        <input id="c-username" name="username" required defaultValue={existing?.username ?? ""} className={inputCls} />

        <label htmlFor="c-auth" className="mt-3 block text-sm font-medium text-gray-700">
          Auth method
        </label>
        <select
          id="c-auth"
          data-testid="c-auth"
          value={authMethod}
          onChange={(e) => setAuthMethod(e.target.value as "password" | "key")}
          className={inputCls}
        >
          <option value="password">Password</option>
          <option value="key">Private key</option>
        </select>

        {authMethod === "password" ? (
          <>
            <label htmlFor="c-password" className="mt-3 block text-sm font-medium text-gray-700">
              Password {existing && <span className="font-normal text-gray-400">(empty = keep stored)</span>}
            </label>
            <input
              id="c-password"
              name="password"
              type="password"
              autoComplete="new-password"
              placeholder={existing ? "••••••••" : ""}
              className={inputCls}
            />
          </>
        ) : (
          <>
            <label htmlFor="c-key" className="mt-3 block text-sm font-medium text-gray-700">
              Private key {existing && <span className="font-normal text-gray-400">(empty = keep stored)</span>}
            </label>
            <textarea
              id="c-key"
              name="private_key"
              rows={4}
              placeholder={existing ? "••••••••" : "-----BEGIN OPENSSH PRIVATE KEY-----"}
              className={inputCls}
            />
            <label htmlFor="c-passphrase" className="mt-3 block text-sm font-medium text-gray-700">
              Key passphrase {existing && <span className="font-normal text-gray-400">(empty = keep stored)</span>}
            </label>
            <input
              id="c-passphrase"
              name="key_passphrase"
              type="password"
              autoComplete="new-password"
              placeholder={existing ? "••••••••" : ""}
              className={inputCls}
            />
          </>
        )}

        <label htmlFor="c-fingerprint" className="mt-3 block text-sm font-medium text-gray-700">
          Host key fingerprint
        </label>
        <input
          id="c-fingerprint"
          name="host_key_fingerprint"
          required
          defaultValue={existing?.host_key_fingerprint ?? ""}
          className={inputCls}
        />

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
            data-testid="connection-save"
            className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
