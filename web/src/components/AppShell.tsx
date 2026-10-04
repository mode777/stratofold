// Layout shell (design D5): mobile-first header, off-canvas vdir
// switcher drawer on small screens, persistent sidebar on md+, and the
// logout action.

import { useState } from "react";
import { Link, NavLink, Outlet } from "react-router";
import { useSession } from "../lib/session";
import { UploadPanel } from "./UploadPanel";
import { VdirSwitcher } from "./VdirSwitcher";

function NavLinks({ onClick }: { onClick?: () => void }) {
  const cls =
    "rounded px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-100 aria-[current=page]:bg-blue-50 aria-[current=page]:text-blue-700";
  return (
    <>
      <NavLink to="/connections" className={cls} onClick={onClick}>
        Connections
      </NavLink>
      <NavLink to="/vdirs" className={cls} onClick={onClick}>
        Vdirs
      </NavLink>
    </>
  );
}

export function AppShell() {
  const { userEmail, logout } = useSession();
  const [drawerOpen, setDrawerOpen] = useState(false);

  return (
    <div className="flex min-h-dvh flex-col bg-white text-gray-900">
      <header className="flex h-14 items-center gap-2 border-b border-gray-200 px-3">
        <button
          type="button"
          aria-label="Open navigation"
          data-testid="nav-toggle"
          onClick={() => setDrawerOpen(true)}
          className="rounded p-2 text-gray-600 hover:bg-gray-100 md:hidden"
        >
          ☰
        </button>
        <Link to="/" className="text-lg font-semibold text-blue-700">
          Stratofold
        </Link>
        <nav aria-label="Primary" className="ml-auto flex items-center gap-1">
          <span className="hidden sm:inline text-sm text-gray-500">{userEmail}</span>
          <NavLinks />
          <button
            type="button"
            data-testid="logout"
            onClick={() => void logout()}
            className="rounded px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-100"
          >
            Log out
          </button>
        </nav>
      </header>

      <div className="flex flex-1">
        <aside className="hidden w-64 shrink-0 border-r border-gray-200 md:block" aria-label="Virtual directories">
          <VdirSwitcher />
        </aside>

        {drawerOpen && (
          <div className="fixed inset-0 z-40 md:hidden" data-testid="drawer">
            <div
              className="absolute inset-0 bg-black/40"
              aria-hidden="true"
              onClick={() => setDrawerOpen(false)}
            />
            <aside
              aria-label="Virtual directories"
              className="absolute inset-y-0 left-0 w-72 overflow-auto bg-white shadow-xl"
            >
              <div className="flex h-14 items-center justify-between border-b border-gray-200 px-3">
                <span className="font-semibold text-blue-700">Stratofold</span>
                <button
                  type="button"
                  aria-label="Close navigation"
                  onClick={() => setDrawerOpen(false)}
                  className="rounded p-1 text-gray-500 hover:bg-gray-100"
                >
                  ✕
                </button>
              </div>
              <NavLinks onClick={() => setDrawerOpen(false)} />
              <VdirSwitcher onNavigate={() => setDrawerOpen(false)} />
            </aside>
          </div>
        )}

        <main className="min-w-0 flex-1">
          <Outlet />
        </main>
      </div>

      <UploadPanel />
    </div>
  );
}
