// Login screen: the only thing an unauthenticated visitor sees
// (web-ui spec). Posts to /api/sf/auth; failure keeps the user here
// with an error; success hands control back to the session provider.

import { useState, type FormEvent } from "react";
import { useSession } from "../lib/session";

export function LoginPage() {
  const { login } = useSession();
  const [identity, setIdentity] = useState("");
  const [password, setPassword] = useState("");
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
    <div className="flex min-h-dvh items-center justify-center bg-gray-50 p-4">
      <form
        onSubmit={onSubmit}
        aria-label="Log in"
        className="w-full max-w-sm rounded-lg border border-gray-200 bg-white p-6 shadow-sm"
      >
        <h1 className="mb-1 text-xl font-semibold text-gray-900">Stratofold</h1>
        <p className="mb-4 text-sm text-gray-500">Sign in to your files</p>

        <label htmlFor="identity" className="block text-sm font-medium text-gray-700">
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
          className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-600 focus:outline-none"
        />

        <label htmlFor="password" className="mt-3 block text-sm font-medium text-gray-700">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-600 focus:outline-none"
        />

        {error && (
          <p role="alert" data-testid="login-error" className="mt-3 text-sm text-red-600">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={busy}
          data-testid="login-submit"
          className="mt-4 w-full rounded bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}
