// Login screen (web-ui spec): the only thing an unauthenticated
// visitor sees. iOS full-screen card: app mark, inset credential rows,
// password eye toggle, error banner, busy state.

import { useState, type FormEvent } from "react";
import { useSession } from "../lib/session";
import { EyeIcon, EyeOffIcon, LinkIcon } from "../components/icons";

export function LoginPage() {
  const { login } = useSession();
  const [identity, setIdentity] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(identity.trim(), password);
      // SessionProvider flips to authenticated and swaps the screen.
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-ios-bg px-6">
      <div className="mb-4 flex h-20 w-20 items-center justify-center rounded-3xl bg-gradient-to-br from-ios-blue to-blue-600 text-white shadow-lg shadow-ios-blue/25">
        <LinkIcon className="text-4xl" />
      </div>
      <h1 className="text-2xl font-bold tracking-tight text-ios-label">Stratofold</h1>
      <p className="mb-7 text-sm text-ios-secondary/70">Sign in to your files</p>

      <form onSubmit={onSubmit} aria-label="Log in" className="w-full max-w-sm">
        {error && (
          <div
            role="alert"
            data-testid="login-error"
            className="mb-4 flex items-center gap-2.5 rounded-xl border border-ios-red/20 bg-ios-red/10 p-3 text-xs font-medium text-ios-red"
          >
            {error}
          </div>
        )}

        <div className="mb-6 divide-y divide-ios-separator overflow-hidden rounded-2xl border border-black/5 bg-ios-card shadow-sm">
          <div className="flex items-center px-4 py-3.5">
            <label htmlFor="identity" className="w-20 text-sm text-ios-secondary/80">
              Email
            </label>
            <input
              id="identity"
              name="identity"
              type="email"
              autoComplete="username"
              required
              value={identity}
              onChange={(e) => setIdentity(e.target.value)}
              placeholder="name@domain.com"
              className="min-w-0 flex-1 bg-transparent text-sm text-ios-label outline-none"
            />
          </div>
          <div className="flex items-center px-4 py-3.5">
            <label htmlFor="password" className="w-20 text-sm text-ios-secondary/80">
              Password
            </label>
            <input
              id="password"
              name="password"
              type={showPassword ? "text" : "password"}
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="min-w-0 flex-1 bg-transparent text-sm text-ios-label outline-none"
            />
            <button
              type="button"
              aria-label={showPassword ? "Hide password" : "Show password"}
              onClick={() => setShowPassword((v) => !v)}
              className="ml-2 text-ios-secondary/50 hover:text-ios-label"
            >
              {showPassword ? <EyeOffIcon /> : <EyeIcon />}
            </button>
          </div>
        </div>

        <button
          type="submit"
          disabled={busy}
          data-testid="login-submit"
          className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-ios-blue text-base font-semibold text-white shadow-sm active:opacity-80 disabled:opacity-60"
        >
          {busy && (
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
          )}
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>

      <p className="mt-6 text-center text-xs text-ios-secondary/60">
        Files remain on your own SSH servers.
        <br />
        Zero telemetry or offline caching.
      </p>
    </div>
  );
}
