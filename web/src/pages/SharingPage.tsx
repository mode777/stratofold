// Sharing & roles (web-ui spec): a pushed screen for the vdir owner —
// invite by email (resolved through the lookup route) with a viewer /
// editor role choice, list people with access, change a role, revoke.
// Self-share is rejected client-side; duplicates surface the server's
// rejection.

import { useEffect, useState, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router";
import { lookupUser } from "../lib/lookup";
import { isValidPublicSlug, publicAliasPath } from "../lib/publicUrl";
import {
  createShare,
  deleteShare,
  listSharesForVdir,
  listVdirs,
  toApiFailure,
  updateShare,
  updateVdir,
  type ShareRecord,
  type VdirRecord,
} from "../lib/records";
import { useSession } from "../lib/session";
import { FailureState, Spinner } from "../components/Errors";
import { ChevronLeftIcon, LinkIcon, PersonIcon } from "../components/icons";
import { ApiFailure } from "../lib/filesApi";

export function SharingPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { userId, userEmail } = useSession();

  const [vdir, setVdir] = useState<VdirRecord | null>(null);
  const [shares, setShares] = useState<ShareRecord[]>([]);
  const [failure, setFailure] = useState<ApiFailure | null>(null);
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);

  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"viewer" | "editor">("viewer");
  const [grantError, setGrantError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const [slugInput, setSlugInput] = useState("");
  const [slugError, setSlugError] = useState<string | null>(null);
  const [slugBusy, setSlugBusy] = useState(false);
  const [slugSaved, setSlugSaved] = useState(false);

  // The public link (web-ui spec): the pretty alias when one is
  // registered, otherwise the plain /v URL. No token — its meaning is
  // entirely the vdir's current publicness. The link always renders as
  // selectable text so the clipboard API's secure-context requirement
  // can never make it unobtainable.
  const publicUrl = vdir
    ? `${window.location.origin}${
        vdir.public_slug ? publicAliasPath(vdir.public_slug) : `/v/${vdir.id}`
      }`
    : "";
  const isOwner = vdir !== null && vdir.owner === userId;
  const copyPublicLink = async () => {
    try {
      await navigator.clipboard.writeText(publicUrl);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  useEffect(() => {
    setSlugInput(vdir?.public_slug ?? "");
  }, [vdir?.public_slug]);

  const slugErrorText = (err: unknown): string => {
    if (err instanceof ApiFailure) {
      const field = err.fieldErrors?.public_slug;
      if (field?.code === "validation_not_unique") return "That public name is already taken.";
      if (field) return "That public name is not valid.";
    }
    return toApiFailure(err).message;
  };

  const saveSlug = async (e: FormEvent) => {
    e.preventDefault();
    const next = slugInput.trim().toLowerCase();
    setSlugError(null);
    setSlugSaved(false);
    if (next !== "" && !isValidPublicSlug(next)) {
      setSlugError("Use 2–63 lowercase letters, digits, or hyphens, starting and ending with a letter or digit.");
      return;
    }
    setSlugBusy(true);
    try {
      await updateVdir(id, { public_slug: next });
      setSlugInput(next);
      setSlugSaved(true);
      setAttempt((n) => n + 1);
    } catch (err) {
      setSlugError(slugErrorText(err));
    } finally {
      setSlugBusy(false);
    }
  };

  const releaseSlug = async () => {
    setSlugError(null);
    setSlugSaved(false);
    setSlugBusy(true);
    try {
      await updateVdir(id, { public_slug: "" });
      setSlugInput("");
      setSlugSaved(true);
      setAttempt((n) => n + 1);
    } catch (err) {
      setSlugError(slugErrorText(err));
    } finally {
      setSlugBusy(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void Promise.all([listVdirs(), listSharesForVdir(id)])
      .then(([all, records]) => {
        if (cancelled) return;
        setVdir(all.find((v) => v.id === id) ?? null);
        setShares(records);
        setFailure(null);
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
  }, [id, attempt]);

  const grant = async (e: FormEvent) => {
    e.preventDefault();
    setGrantError(null);
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
      await createShare({ vdir: id, user: grantee.id, role });
      setEmail("");
      setAttempt((n) => n + 1);
    } catch (err) {
      setGrantError(toApiFailure(err).message);
    } finally {
      setBusy(false);
    }
  };

  const changeRole = async (share: ShareRecord, nextRole: "viewer" | "editor") => {
    try {
      await updateShare(share.id, { role: nextRole });
      setAttempt((n) => n + 1);
    } catch (err) {
      setGrantError(toApiFailure(err).message);
    }
  };

  const revoke = async (share: ShareRecord) => {
    try {
      await deleteShare(share.id);
      setAttempt((n) => n + 1);
    } catch (err) {
      setGrantError(toApiFailure(err).message);
    }
  };

  return (
    <div data-testid="sharing-page" className="flex min-h-dvh flex-col">
      <div className="border-b border-ios-separator bg-ios-card px-4 pt-1 pb-1">
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={() => void navigate(`/settings/vdirs/${id}`)}
            className="flex items-center text-base text-ios-blue"
          >
            <ChevronLeftIcon className="mr-0.5 text-sm" /> Vdir
          </button>
          <span className="text-xs font-bold text-ios-secondary/50">{vdir?.name ?? ""}</span>
        </div>
        <h1 className="mt-0.5 text-[30px] font-bold leading-tight tracking-tight text-ios-label">Sharing</h1>
      </div>

      {loading ? (
        <Spinner />
      ) : failure ? (
        <FailureState failure={failure} onRetry={() => setAttempt((n) => n + 1)} />
      ) : (
        <div className="flex-1 space-y-4 px-4 py-3 pb-24">
          <form onSubmit={grant} data-testid="share-form" className="space-y-3 rounded-2xl border border-black/5 bg-ios-card p-4 shadow-sm">
            <h2 className="text-xs font-bold uppercase tracking-wider text-ios-secondary/60">Invite Collaborator</h2>
            <input
              id="s-email"
              name="email"
              type="email"
              required
              aria-label="Share with (email)"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="colleague@domain.com"
              className="w-full rounded-xl border border-ios-separator bg-ios-bg px-3 py-2.5 text-sm outline-none"
            />
            <div className="space-y-2 text-xs">
              <label className="flex items-start gap-2.5 rounded-xl bg-ios-bg p-2">
                <input
                  type="radio"
                  name="inviteRole"
                  data-testid="s-role-viewer"
                  checked={role === "viewer"}
                  onChange={() => setRole("viewer")}
                  className="mt-0.5 accent-ios-blue"
                />
                <span>
                  <span className="block font-bold text-ios-label">Viewer</span>
                  <span className="text-ios-secondary/60">Browse and download only</span>
                </span>
              </label>
              <label className="flex items-start gap-2.5 rounded-xl bg-ios-bg p-2">
                <input
                  type="radio"
                  name="inviteRole"
                  data-testid="s-role-editor"
                  checked={role === "editor"}
                  onChange={() => setRole("editor")}
                  className="mt-0.5 accent-ios-blue"
                />
                <span>
                  <span className="block font-bold text-ios-label">Editor</span>
                  <span className="text-ios-secondary/60">Also upload, rename, move, and delete</span>
                </span>
              </label>
            </div>
            {grantError && (
              <p role="alert" data-testid="share-error" className="text-xs text-ios-red">
                {grantError}
              </p>
            )}
            <button
              type="submit"
              disabled={busy}
              data-testid="s-grant"
              className="w-full rounded-xl bg-ios-blue py-2.5 text-xs font-semibold text-white shadow-sm disabled:opacity-50"
            >
              {busy ? "Resolving…" : "Grant Access"}
            </button>
          </form>

          {isOwner && (
            <section
              data-testid="public-name-section"
              className="space-y-2 rounded-2xl border border-black/5 bg-ios-card p-4 shadow-sm"
            >
              <h2 className="text-xs font-bold uppercase tracking-wider text-ios-secondary/60">Public name</h2>
              <p className="text-xs text-ios-secondary/70">
                Give this folder a memorable address. It only works while the vdir is public.
              </p>
              <form onSubmit={saveSlug} className="space-y-2">
                <div className="flex items-center gap-2">
                  <span className="shrink-0 text-xs font-medium text-ios-secondary/70">/apps/</span>
                  <input
                    data-testid="public-name-input"
                    aria-label="Public name"
                    value={slugInput}
                    onChange={(e) => {
                      setSlugInput(e.target.value.toLowerCase());
                      setSlugError(null);
                      setSlugSaved(false);
                    }}
                    placeholder="my-public-folder"
                    className="min-w-0 flex-1 rounded-xl border border-ios-separator bg-ios-bg px-3 py-2 text-sm outline-none"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="submit"
                    data-testid="public-name-save"
                    disabled={slugBusy}
                    className="rounded-xl bg-ios-blue px-3 py-2 text-xs font-semibold text-white shadow-sm disabled:opacity-50"
                  >
                    {slugBusy ? "Saving…" : "Save name"}
                  </button>
                  {vdir?.public_slug && (
                    <button
                      type="button"
                      data-testid="public-name-remove"
                      disabled={slugBusy}
                      onClick={() => void releaseSlug()}
                      className="rounded-xl border border-ios-red/20 px-3 py-2 text-xs font-medium text-ios-red disabled:opacity-50"
                    >
                      Remove
                    </button>
                  )}
                </div>
                {slugError && (
                  <p role="alert" data-testid="public-name-error" className="text-xs text-ios-red">
                    {slugError}
                  </p>
                )}
                {slugSaved && (
                  <p data-testid="public-name-saved" className="text-xs font-semibold text-ios-green">
                    Public name saved.
                  </p>
                )}
                {vdir && !vdir.is_public && vdir.public_slug && (
                  <p data-testid="public-name-reserved" className="text-xs text-ios-secondary/70">
                    This name is reserved; the pretty URL becomes active when the vdir is published.
                  </p>
                )}
                <p className="text-[11px] text-ios-secondary/50">
                  2–63 lowercase letters, digits, or hyphens; start and end with a letter or digit.
                </p>
              </form>
            </section>
          )}

          {vdir?.is_public ? (
            <section
              data-testid="public-link-section"
              className="space-y-2 rounded-2xl border border-black/5 bg-ios-card p-4 shadow-sm"
            >
              <h2 className="text-xs font-bold uppercase tracking-wider text-ios-secondary/60">Public link</h2>
              <p className="flex items-start gap-2 text-xs text-ios-secondary/70">
                <LinkIcon className="mt-0.5 shrink-0 text-ios-blue" />
                <span>Anyone with this link can browse and download — no account needed.</span>
              </p>
              <div className="flex items-center gap-2">
                <code
                  data-testid="public-link"
                  className="min-w-0 flex-1 truncate rounded-xl bg-ios-bg px-3 py-2 text-xs text-ios-label select-all"
                >
                  {publicUrl}
                </code>
                <button
                  type="button"
                  data-testid="public-link-copy"
                  onClick={() => void copyPublicLink()}
                  className="shrink-0 rounded-xl bg-ios-blue px-3 py-2 text-xs font-semibold text-white shadow-sm active:scale-95"
                >
                  {copied ? "Copied" : "Copy link"}
                </button>
              </div>
              {copied && (
                <p data-testid="public-link-copied" className="text-xs font-semibold text-ios-green">
                  Link copied to the clipboard.
                </p>
              )}
            </section>
          ) : (
            vdir && (
              <section
                data-testid="public-link-section"
                className="space-y-1 rounded-2xl border border-black/5 bg-ios-card p-4 shadow-sm"
              >
                <h2 className="text-xs font-bold uppercase tracking-wider text-ios-secondary/60">Public link</h2>
                <p data-testid="public-link-none" className="text-xs text-ios-secondary/70">
                  No public link — this vdir is not public. Turn on public access in the vdir's settings to get one.
                </p>
                {vdir.public_slug && (
                  <p data-testid="public-link-reserved" className="text-xs text-ios-secondary/70">
                    The public name <code>/apps/{vdir.public_slug}</code> is reserved and becomes active when this
                    vdir is published.
                  </p>
                )}
              </section>
            )
          )}

          <section>
            <h2 className="px-2 py-1 text-xs font-semibold uppercase tracking-wider text-ios-secondary/60">
              People with access
            </h2>
            {shares.length === 0 ? (
              <p className="px-2 text-sm text-ios-secondary/50">Not shared with anyone yet.</p>
            ) : (
              <div className="divide-y divide-ios-separator overflow-hidden rounded-2xl border border-black/5 bg-ios-card shadow-sm">
                {shares.map((share) => (
                  <div key={share.id} data-testid="share-row" className="flex items-center gap-3 px-4 py-3">
                    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-ios-secondary/10 text-ios-secondary">
                      <PersonIcon className="text-xs" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-ios-label">
                        user-{share.user.slice(0, 7)}
                      </span>
                      <span className="block text-xs text-ios-secondary/60">
                        {share.role === "editor" ? "Editor" : "Viewer"}
                      </span>
                    </span>
                    <select
                      aria-label="Change role"
                      data-testid={`share-role-${share.id}`}
                      value={share.role}
                      onChange={(e) => void changeRole(share, e.target.value as "viewer" | "editor")}
                      className="rounded-lg border border-ios-separator bg-ios-bg px-2 py-1 text-xs"
                    >
                      <option value="viewer">Viewer</option>
                      <option value="editor">Editor</option>
                    </select>
                    <button
                      type="button"
                      data-testid={`share-revoke-${share.id}`}
                      onClick={() => void revoke(share)}
                      className="rounded-lg border border-ios-red/20 px-2 py-1 text-xs font-medium text-ios-red"
                    >
                      Revoke
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
