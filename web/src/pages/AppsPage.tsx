// Connected apps (web-ui spec, change add-vdir-access-tokens): the
// Settings screen for minting, reviewing, and revoking vdir-scoped
// access tokens. The plaintext token exists only in the one-time panel;
// the list always comes from the metadata-only management route.

import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import {
  canWrite,
  effectiveRoleForVdir,
  listVdirs,
  toApiFailure,
  type EffectiveRole,
  type VdirRecord,
} from "../lib/records";
import { useSession } from "../lib/session";
import {
  listTokens,
  mintToken,
  revokeToken,
  type MintedToken,
  type MintTokenInput,
  type TokenRole,
  type VdirToken,
} from "../lib/tokensApi";
import { Alert } from "../components/Dialog";
import { EmptyState, FailureState, Spinner } from "../components/Errors";
import { ChevronLeftIcon, LinkIcon } from "../components/icons";
import type { ApiFailure } from "../lib/filesApi";

type ExpiryPreset = "never" | "7" | "30" | "90" | "365";

type VdirChoice = { vdir: VdirRecord; role: EffectiveRole };

type Retry =
  | { kind: "mint"; input: MintTokenInput }
  | { kind: "revoke"; token: VdirToken };

function expiresAtFor(preset: ExpiryPreset): string | undefined {
  if (preset === "never") return undefined;
  const days = Number(preset);
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

function formatDate(value: string | null): string {
  if (!value) return "Never";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString();
}

export function AppsPage() {
  const navigate = useNavigate();
  const { userId } = useSession();

  const [tokens, setTokens] = useState<VdirToken[]>([]);
  const [vdirs, setVdirs] = useState<VdirChoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState<ApiFailure | null>(null);
  const [attempt, setAttempt] = useState(0);

  const [vdirId, setVdirId] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<TokenRole>("viewer");
  const [expiry, setExpiry] = useState<ExpiryPreset>("30");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [minted, setMinted] = useState<MintedToken | null>(null);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const [revoking, setRevoking] = useState<VdirToken | null>(null);
  const [actionFailure, setActionFailure] = useState<ApiFailure | null>(null);
  const [retry, setRetry] = useState<Retry | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void Promise.all([listTokens(), listVdirs()])
      .then(async ([tokenList, vdirList]) => {
        const withRoles = await Promise.all(
          vdirList.map(async (vdir) => ({ vdir, role: await effectiveRoleForVdir(vdir, userId) })),
        );
        if (cancelled) return;
        const accessible = withRoles.filter((entry) => entry.role !== "none");
        setTokens(tokenList);
        setVdirs(accessible);
        setFailure(null);
        setVdirId((prev) =>
          accessible.some((entry) => entry.vdir.id === prev) ? prev : accessible[0]?.vdir.id ?? "",
        );
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
  }, [userId, attempt]);

  const selected = vdirs.find((entry) => entry.vdir.id === vdirId);
  const canEdit = selected ? canWrite(selected.role) : false;

  useEffect(() => {
    if (!canEdit && role === "editor") setRole("viewer");
  }, [canEdit, role]);

  const performMint = async (input: MintTokenInput) => {
    setBusy(true);
    setFormError(null);
    setActionFailure(null);
    setRetry(null);
    try {
      const created = await mintToken(input);
      setMinted(created);
      setCopied(false);
      setCopyError(false);
      setName("");
      setAttempt((n) => n + 1);
    } catch (err) {
      const apiFailure = toApiFailure(err);
      setActionFailure(apiFailure);
      setFormError(apiFailure.message);
      setRetry({ kind: "mint", input });
    } finally {
      setBusy(false);
    }
  };

  const performRevoke = async (token: VdirToken) => {
    setBusy(true);
    setActionFailure(null);
    setRetry(null);
    try {
      await revokeToken(token.id);
      setRevoking(null);
      setAttempt((n) => n + 1);
    } catch (err) {
      const apiFailure = toApiFailure(err);
      setActionFailure(apiFailure);
      setRetry({ kind: "revoke", token });
      setRevoking(null);
    } finally {
      setBusy(false);
    }
  };

  const retryAction = () => {
    if (!retry) return;
    if (retry.kind === "mint") void performMint(retry.input);
    else void performRevoke(retry.token);
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setFormError(null);
    if (!vdirId) {
      setFormError("Choose a virtual directory.");
      return;
    }
    const trimmed = name.trim();
    if (!trimmed) {
      setFormError("Give the token a name.");
      return;
    }
    const input: MintTokenInput = {
      vdir: vdirId,
      name: trimmed,
      role: canEdit ? role : "viewer",
    };
    const expires = expiresAtFor(expiry);
    if (expires) input.expires_at = expires;
    void performMint(input);
  };

  const copyToken = async () => {
    if (!minted) return;
    try {
      await navigator.clipboard.writeText(minted.token);
      setCopied(true);
      setCopyError(false);
    } catch {
      setCopied(false);
      setCopyError(true);
    }
  };

  return (
    <div data-testid="apps-page" className="flex min-h-dvh flex-col pb-24 md:pb-0">
      <div className="border-b border-ios-separator bg-ios-card px-4 pt-1 pb-1">
        <div className="flex items-center justify-between">
          <button
            type="button"
            data-testid="apps-back"
            onClick={() => void navigate("/settings")}
            className="flex items-center text-base text-ios-blue"
          >
            <ChevronLeftIcon className="mr-0.5 text-sm" /> Settings
          </button>
          <LinkIcon className="text-base text-ios-secondary/50" />
        </div>
        <h1 className="mt-0.5 text-[30px] font-bold leading-tight tracking-tight text-ios-label">
          Connected apps
        </h1>
      </div>

      <div className="flex-1 space-y-4 px-4 py-3">
        {minted && (
          <section
            data-testid="minted-token-panel"
            className="space-y-2 rounded-2xl border border-ios-blue/20 bg-ios-blue/5 p-4"
          >
            <h2 className="text-sm font-bold text-ios-label">Token created</h2>
            <p className="text-xs text-ios-secondary/80">
              Copy it now — it won&apos;t be shown again.
            </p>
            <code
              data-testid="minted-token"
              className="block overflow-x-auto rounded-xl bg-ios-card px-3 py-2 font-mono text-xs text-ios-label"
            >
              {minted.token}
            </code>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                data-testid="copy-token"
                onClick={() => void copyToken()}
                className="rounded-xl bg-ios-blue px-3 py-2 text-xs font-semibold text-white shadow-sm"
              >
                {copied ? "Copied" : "Copy token"}
              </button>
              <button
                type="button"
                data-testid="dismiss-token"
                onClick={() => {
                  setMinted(null);
                  setCopied(false);
                  setCopyError(false);
                }}
                className="rounded-xl bg-ios-card px-3 py-2 text-xs font-semibold text-ios-label shadow-sm"
              >
                Done
              </button>
              {copyError && (
                <span role="alert" data-testid="token-copy-error" className="text-xs text-ios-red">
                  Copy failed — select the token manually.
                </span>
              )}
            </div>
          </section>
        )}

        {actionFailure && (
          <FailureState
            failure={actionFailure}
            onRetry={actionFailure.kind === "retryable" ? retryAction : undefined}
          />
        )}

        {loading ? (
          <Spinner />
        ) : failure ? (
          <FailureState failure={failure} onRetry={() => setAttempt((n) => n + 1)} />
        ) : (
          <>
            <form
              onSubmit={submit}
              data-testid="token-form"
              className="space-y-3 rounded-2xl border border-black/5 bg-ios-card p-4 shadow-sm"
            >
              <h2 className="text-xs font-bold uppercase tracking-wider text-ios-secondary/60">
                New access token
              </h2>
              <label className="block space-y-1 text-xs font-semibold text-ios-secondary/70">
                Virtual directory
                <select
                  data-testid="token-vdir"
                  value={vdirId}
                  onChange={(e) => setVdirId(e.target.value)}
                  disabled={vdirs.length === 0 || busy}
                  className="w-full rounded-xl border border-ios-separator bg-ios-bg px-3 py-2.5 text-sm font-normal text-ios-label outline-none"
                >
                  {vdirs.map((entry) => (
                    <option key={entry.vdir.id} value={entry.vdir.id}>
                      {entry.vdir.name} ({entry.role})
                    </option>
                  ))}
                </select>
              </label>
              <label className="block space-y-1 text-xs font-semibold text-ios-secondary/70">
                Name
                <input
                  data-testid="token-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  maxLength={100}
                  placeholder="e.g. Photo sync"
                  className="w-full rounded-xl border border-ios-separator bg-ios-bg px-3 py-2.5 text-sm font-normal text-ios-label outline-none"
                />
              </label>
              <div className="space-y-2 text-xs">
                <label className="flex items-start gap-2.5 rounded-xl bg-ios-bg p-2">
                  <input
                    type="radio"
                    name="tokenRole"
                    data-testid="token-role-viewer"
                    checked={role === "viewer"}
                    onChange={() => setRole("viewer")}
                    className="mt-0.5 accent-ios-blue"
                  />
                  <span>
                    <span className="block font-bold text-ios-label">Viewer</span>
                    <span className="text-ios-secondary/60">Browse and download only</span>
                  </span>
                </label>
                {canEdit && (
                  <label className="flex items-start gap-2.5 rounded-xl bg-ios-bg p-2">
                    <input
                      type="radio"
                      name="tokenRole"
                      data-testid="token-role-editor"
                      checked={role === "editor"}
                      onChange={() => setRole("editor")}
                      className="mt-0.5 accent-ios-blue"
                    />
                    <span>
                      <span className="block font-bold text-ios-label">Editor</span>
                      <span className="text-ios-secondary/60">Also upload, rename, move, and delete</span>
                    </span>
                  </label>
                )}
              </div>
              <label className="block space-y-1 text-xs font-semibold text-ios-secondary/70">
                Expiry
                <select
                  data-testid="token-expiry"
                  value={expiry}
                  onChange={(e) => setExpiry(e.target.value as ExpiryPreset)}
                  disabled={busy}
                  className="w-full rounded-xl border border-ios-separator bg-ios-bg px-3 py-2.5 text-sm font-normal text-ios-label outline-none"
                >
                  <option value="never">Never</option>
                  <option value="7">7 days</option>
                  <option value="30">30 days</option>
                  <option value="90">90 days</option>
                  <option value="365">365 days</option>
                </select>
              </label>
              {vdirs.length === 0 && (
                <p className="text-xs text-ios-secondary/60">
                  No vdirs available — create one or ask for a share first.
                </p>
              )}
              {formError && (
                <p role="alert" data-testid="token-error" className="text-xs text-ios-red">
                  {formError}
                </p>
              )}
              <button
                type="submit"
                data-testid="token-mint"
                disabled={busy || vdirs.length === 0}
                className="w-full rounded-xl bg-ios-blue py-2.5 text-xs font-semibold text-white shadow-sm disabled:opacity-50"
              >
                {busy ? "Working…" : "Create token"}
              </button>
            </form>

            {tokens.length === 0 ? (
              <EmptyState
                title="No connected apps"
                hint="Create a token for a website or script that needs access to one vdir."
              />
            ) : (
              <div className="divide-y divide-ios-separator overflow-hidden rounded-2xl border border-black/5 bg-ios-card shadow-sm">
                {tokens.map((token) => (
                  <div key={token.id} data-testid="token-row" className="space-y-1 px-4 py-3.5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-base font-semibold text-ios-label">{token.name}</p>
                        <p className="truncate text-xs text-ios-secondary/60">
                          {token.vdir_name} · {token.role}
                        </p>
                      </div>
                      <button
                        type="button"
                        data-testid={`token-revoke-${token.id}`}
                        onClick={() => setRevoking(token)}
                        className="shrink-0 text-xs font-semibold text-ios-red"
                      >
                        Revoke
                      </button>
                    </div>
                    <code className="block font-mono text-[11px] text-ios-secondary/60">
                      {token.token_hint}
                    </code>
                    <p className="text-[11px] text-ios-secondary/50">
                      Expires {formatDate(token.expires_at)} · Last used {formatDate(token.last_used_at)}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {revoking && (
        <Alert
          title="Revoke token"
          message={`“${revoking.name}” will stop working immediately.`}
          confirmLabel="Revoke"
          destructive
          busy={busy}
          onCancel={() => setRevoking(null)}
          onConfirm={() => void performRevoke(revoking)}
          confirmTestid="token-revoke-confirm"
        />
      )}
    </div>
  );
}
