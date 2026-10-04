// Share management dialog (web-ui spec): grant viewer/editor by email
// resolved through the lookup route, change a role, revoke. The
// owner-self grant is rejected client-side before submission;
// duplicate grants surface the server's rejection.

import { useEffect, useState, type FormEvent } from "react";
import { lookupUser } from "../lib/lookup";
import {
  createShare,
  deleteShare,
  listSharesForVdir,
  toApiFailure,
  updateShare,
  type ShareRecord,
  type VdirRecord,
} from "../lib/records";
import { useSession } from "../lib/session";
import { Dialog } from "../components/Dialog";
import { FailureState, Spinner } from "../components/Errors";
import type { ApiFailure } from "../lib/filesApi";

const inputCls = "mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-600 focus:outline-none";

export function ShareDialog({
  vdir,
  onClose,
  onChanged,
}: {
  vdir: VdirRecord;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { userId, userEmail } = useSession();
  const [shares, setShares] = useState<ShareRecord[]>([]);
  const [failure, setFailure] = useState<ApiFailure | null>(null);
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);

  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"viewer" | "editor">("viewer");
  const [grantError, setGrantError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void listSharesForVdir(vdir.id)
      .then((records) => {
        if (!cancelled) {
          setShares(records);
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
  }, [vdir.id, attempt]);

  const grant = async (e: FormEvent) => {
    e.preventDefault();
    setGrantError(null);

    // Client-side guard (spec): the owner cannot share with
    // themselves — rejected before any submission.
    if (userEmail && email.trim().toLowerCase() === userEmail.toLowerCase()) {
      setGrantError("You cannot share a vdir with yourself.");
      return;
    }

    setBusy(true);
    try {
      const grantee = await lookupUser(email.trim());
      if (grantee.id === userId) {
        setGrantError("You cannot share a vdir with yourself.");
        return;
      }
      await createShare({ vdir: vdir.id, user: grantee.id, role });
      setEmail("");
      setAttempt((n) => n + 1);
      onChanged();
    } catch (err) {
      const failure = toApiFailure(err);
      // A duplicate arrives as the server's rejection (unique
      // vdir+user); surface it verbatim.
      setGrantError(failure.message);
    } finally {
      setBusy(false);
    }
  };

  const changeRole = async (share: ShareRecord, nextRole: "viewer" | "editor") => {
    try {
      await updateShare(share.id, { role: nextRole });
      setAttempt((n) => n + 1);
      onChanged();
    } catch (err) {
      setGrantError(toApiFailure(err).message);
    }
  };

  const revoke = async (share: ShareRecord) => {
    try {
      await deleteShare(share.id);
      setAttempt((n) => n + 1);
      onChanged();
    } catch (err) {
      setGrantError(toApiFailure(err).message);
    }
  };

  return (
    <Dialog title={`Shares — ${vdir.name}`} onClose={onClose}>
      {loading ? (
        <Spinner />
      ) : failure ? (
        <FailureState failure={failure} onRetry={() => setAttempt((n) => n + 1)} />
      ) : (
        <>
          <form onSubmit={grant} data-testid="share-form" className="mb-4">
            <label htmlFor="s-email" className="block text-sm font-medium text-gray-700">
              Share with (email)
            </label>
            <input
              id="s-email"
              name="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="grantee@example.com"
              className={inputCls}
            />
            <label htmlFor="s-role" className="mt-3 block text-sm font-medium text-gray-700">
              Role
            </label>
            <select
              id="s-role"
              data-testid="s-role"
              value={role}
              onChange={(e) => setRole(e.target.value as "viewer" | "editor")}
              className={inputCls}
            >
              <option value="viewer">Viewer (browse + download)</option>
              <option value="editor">Editor (+ upload/move/delete)</option>
            </select>
            {grantError && (
              <p role="alert" data-testid="share-error" className="mt-3 text-sm text-red-600">
                {grantError}
              </p>
            )}
            <button
              type="submit"
              disabled={busy}
              data-testid="s-grant"
              className="mt-3 rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {busy ? "Resolving…" : "Grant"}
            </button>
          </form>

          {shares.length === 0 ? (
            <p className="text-sm text-gray-500">Not shared with anyone yet.</p>
          ) : (
            <ul className="divide-y divide-gray-100 rounded border border-gray-200">
              {shares.map((share) => (
                <li key={share.id} className="flex items-center gap-2 px-3 py-2" data-testid="share-row">
                  <span className="min-w-0 flex-1 truncate text-sm">
                    {share.role} · user:{share.user.slice(0, 7)}
                  </span>
                  <select
                    aria-label="Change role"
                    data-testid={`share-role-${share.id}`}
                    value={share.role}
                    onChange={(e) => void changeRole(share, e.target.value as "viewer" | "editor")}
                    className="rounded border border-gray-300 px-2 py-1 text-xs"
                  >
                    <option value="viewer">viewer</option>
                    <option value="editor">editor</option>
                  </select>
                  <button
                    type="button"
                    data-testid={`share-revoke-${share.id}`}
                    onClick={() => void revoke(share)}
                    className="rounded border border-red-200 px-2 py-1 text-xs text-red-700 hover:bg-red-50"
                  >
                    Revoke
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </Dialog>
  );
}
