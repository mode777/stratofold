// Settings destination (web-ui spec): account section with the signed-in
// identity and an all-devices sign-out, plus infrastructure rows for
// Connections and Virtual Directories.

import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { listConnections, type ConnectionRecord } from "../lib/records";
import { useSession } from "../lib/session";
import { useInstallPrompt } from "../lib/useInstallPrompt";
import { useVdirs } from "../lib/useVdirs";
import { Alert } from "../components/Dialog";
import { ChevronRightIcon, FolderIcon, InstallIcon, LogoutIcon, PersonIcon, ServerIcon } from "../components/icons";

export function SettingsPage() {
  const { userEmail, userId, logout } = useSession();
  const { vdirs } = useVdirs();
  const { canInstall, promptInstall } = useInstallPrompt();
  const navigate = useNavigate();
  const [connections, setConnections] = useState<ConnectionRecord[] | null>(null);
  const [confirming, setConfirming] = useState(false);

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

  const ownVdirs = vdirs.filter((v) => v.owner === userId);

  return (
    <div data-testid="settings-page" className="flex min-h-dvh flex-col">
      <div className="px-5 pt-3 pb-2">
        <h1 className="text-[34px] font-bold leading-tight tracking-tight text-ios-label">Settings</h1>
      </div>

      <div className="flex-1 space-y-5 px-4 pb-24">
        <section>
          <h2 className="px-2 py-1 text-xs font-semibold uppercase tracking-wider text-ios-secondary/60">
            Account
          </h2>
          <div className="divide-y divide-ios-separator overflow-hidden rounded-2xl border border-black/5 bg-ios-card shadow-sm">
            <div className="flex items-center gap-3 px-4 py-3.5">
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-ios-blue text-lg font-bold text-white shadow-sm">
                <PersonIcon />
              </span>
              <span className="min-w-0 truncate text-base font-bold text-ios-label">{userEmail}</span>
            </div>
            <button
              type="button"
              data-testid="settings-signout"
              onClick={() => setConfirming(true)}
              className="flex w-full items-center justify-between px-4 py-3.5 text-left font-medium text-ios-red active:bg-ios-bg"
            >
              Sign Out
              <LogoutIcon className="text-sm" />
            </button>
          </div>
        </section>

        {canInstall && (
          <section>
            <h2 className="px-2 py-1 text-xs font-semibold uppercase tracking-wider text-ios-secondary/60">
              App
            </h2>
            <div className="divide-y divide-ios-separator overflow-hidden rounded-2xl border border-black/5 bg-ios-card shadow-sm">
              <button
                type="button"
                data-testid="settings-install"
                onClick={() => void promptInstall()}
                className="flex w-full items-center gap-3 px-4 py-3.5 text-left active:bg-ios-bg"
              >
                <InstallIcon className="text-base text-ios-blue" />
                <span className="flex-1 text-base font-semibold text-ios-label">Install app</span>
                <ChevronRightIcon className="text-xs text-ios-secondary/30" />
              </button>
            </div>
          </section>
        )}

        <section>
          <h2 className="px-2 py-1 text-xs font-semibold uppercase tracking-wider text-ios-secondary/60">
            Infrastructure
          </h2>
          <div className="divide-y divide-ios-separator overflow-hidden rounded-2xl border border-black/5 bg-ios-card shadow-sm">
            <button
              type="button"
              data-testid="settings-connections"
              onClick={() => void navigate("/settings/connections")}
              className="flex w-full items-center gap-3 px-4 py-3.5 text-left active:bg-ios-bg"
            >
              <ServerIcon className="text-base text-ios-blue" />
              <span className="flex-1 text-base font-semibold text-ios-label">Connections</span>
              <span className="text-sm text-ios-secondary/50">{connections?.length ?? "…"}</span>
              <ChevronRightIcon className="text-xs text-ios-secondary/30" />
            </button>
            <button
              type="button"
              data-testid="settings-vdirs"
              onClick={() => void navigate("/settings/vdirs")}
              className="flex w-full items-center gap-3 px-4 py-3.5 text-left active:bg-ios-bg"
            >
              <FolderIcon className="text-base text-ios-blue" />
              <span className="flex-1 text-base font-semibold text-ios-label">Virtual Directories</span>
              <span className="text-sm text-ios-secondary/50">{ownVdirs.length}</span>
              <ChevronRightIcon className="text-xs text-ios-secondary/30" />
            </button>
          </div>
        </section>

        <p className="px-2 text-center text-xs text-ios-secondary/50">
          Stratofold · Files stream directly over encrypted SSH/SFTP
        </p>
      </div>

      {confirming && (
        <Alert
          title="Sign Out"
          message="You'll be signed out on all devices."
          confirmLabel="Sign Out"
          destructive
          onCancel={() => setConfirming(false)}
          onConfirm={() => {
            setConfirming(false);
            void logout();
          }}
          confirmTestid="signout-confirm"
        />
      )}
    </div>
  );
}
