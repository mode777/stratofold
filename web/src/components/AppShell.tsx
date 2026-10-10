// Responsive iOS shell (design D3): a translucent bottom tab bar below
// `md` and a persistent sidebar at `md`+, sharing the same Files /
// Uploads / Settings destinations and the uploads active count. The
// floating uploads indicator appears on non-Uploads destinations while
// uploads are active.

import type { ReactElement } from "react";
import { NavLink, Outlet, useLocation } from "react-router";
import { useUploadQueue } from "../lib/useUploadQueue";
import { FloatingUploadIndicator } from "./FloatingUploadIndicator";
import { FolderIcon, GearIcon, TrayIcon, type IconProps } from "./icons";

type Destination = { to: string; label: string; Icon: (p: IconProps) => ReactElement };

const DESTINATIONS: Destination[] = [
  { to: "/files", label: "Files", Icon: FolderIcon },
  { to: "/uploads", label: "Uploads", Icon: TrayIcon },
  { to: "/settings", label: "Settings", Icon: GearIcon },
];

export function activeUploadCount(items: Array<{ state: string }>): number {
  return items.filter((it) => it.state === "queued" || it.state === "running" || it.state === "paused")
    .length;
}

function UploadsBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span
      data-testid="uploads-badge"
      aria-label={`${count} active uploads`}
      className="absolute -top-1 -right-2 flex h-4 w-4 items-center justify-center rounded-full bg-ios-blue text-[10px] font-bold text-white"
    >
      {count}
    </span>
  );
}

function TabBar({ activeUploads }: { activeUploads: number }) {
  return (
    <nav
      data-testid="tab-bar"
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-30 flex items-start justify-around border-t border-ios-separator bg-ios-card/80 px-3 pt-2 pb-safe backdrop-blur-xl md:hidden"
    >
      {DESTINATIONS.map(({ to, label, Icon }) => (
        <NavLink
          key={to}
          to={to}
          data-testid={`tab-${label.toLowerCase()}`}
          className="flex w-20 flex-col items-center text-ios-secondary/60 aria-[current=page]:text-ios-blue"
        >
          <span className="relative">
            <Icon className="text-xl" />
            {to === "/uploads" && <UploadsBadge count={activeUploads} />}
          </span>
          <span className="text-[10px] font-semibold">{label}</span>
        </NavLink>
      ))}
    </nav>
  );
}

function Sidebar({ activeUploads }: { activeUploads: number }) {
  return (
    <aside
      data-testid="sidebar"
      aria-label="Primary"
      className="hidden w-64 shrink-0 border-r border-ios-separator bg-ios-card md:flex md:flex-col"
    >
      <div className="flex h-14 items-center px-5 text-lg font-semibold text-ios-label">Stratofold</div>
      <nav className="flex flex-col gap-1 p-3">
        {DESTINATIONS.map(({ to, label, Icon }) => (
          <NavLink
            key={to}
            to={to}
            data-testid={`side-${label.toLowerCase()}`}
            className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-base font-medium text-ios-label hover:bg-ios-bg aria-[current=page]:bg-ios-blue/10 aria-[current=page]:text-ios-blue"
          >
            <span className="relative">
              <Icon className="text-xl" />
              {to === "/uploads" && <UploadsBadge count={activeUploads} />}
            </span>
            {label}
          </NavLink>
        ))}
      </nav>
    </aside>
  );
}

export function AppShell() {
  const { pathname } = useLocation();
  const { items } = useUploadQueue();
  const activeUploads = activeUploadCount(items);

  return (
    <div className="flex h-dvh overflow-hidden bg-ios-bg text-ios-label">
      <Sidebar activeUploads={activeUploads} />
      <main className="flex min-w-0 flex-1 flex-col">
        {/* No shell-level bottom padding (design D4 of
            fix-web-ui-and-session-lifetime): the tab bar is a fixed
            overlay, so each destination owns its bottom clearance and
            the browse listing reaches the viewport bottom beneath the
            translucent bar. */}
        <div className="min-h-0 flex-1 overflow-y-auto" data-testid="shell-scroll">
          <Outlet />
        </div>
      </main>
      <TabBar activeUploads={activeUploads} />
      {pathname !== "/uploads" && <FloatingUploadIndicator count={activeUploads} />}
    </div>
  );
}
