import { Navigate, Outlet, Route, Routes, useLocation } from "react-router";
import { SessionProvider, useSession } from "./lib/session";
import { Spinner } from "./components/Errors";
import { AppShell } from "./components/AppShell";
import { PublicGate } from "./components/PublicGate";
import { LoginPage } from "./pages/LoginPage";
import { LocationsPage } from "./pages/LocationsPage";
import { BrowsePage } from "./pages/BrowsePage";
import { PreviewPage } from "./pages/PreviewPage";
import { MovePickerPage } from "./pages/MovePickerPage";
import { UploadsPage } from "./pages/UploadsPage";
import { SettingsPage } from "./pages/SettingsPage";
import { ConnectionsPage } from "./pages/ConnectionsPage";
import { ConnectionFormPage } from "./pages/ConnectionFormPage";
import { VdirsPage } from "./pages/VdirsPage";
import { VdirFormPage } from "./pages/VdirFormPage";
import { SharingPage } from "./pages/SharingPage";
import { NotFoundPage } from "./pages/NotFoundPage";

export function App() {
  return (
    <SessionProvider>
      <SessionGate />
    </SessionProvider>
  );
}

// Session gate (web-ui spec): unauthenticated visitors see only the
// login screen — except for the two route shapes of a public vdir's
// anonymous browsing (browse and preview), which render the
// self-contained public routes instead. A rejected session flips
// state and lands the user back on the login screen from anywhere.
function SessionGate() {
  const { state } = useSession();
  const { pathname } = useLocation();
  if (state === "checking") return <Spinner label="Checking session…" />;
  if (state === "anonymous") {
    return isAnonymousAllowed(pathname) ? <PublicRoutes /> : <LoginPage />;
  }
  return <AppRoutes />;
}

// isAnonymousAllowed reports whether the location is a vdir browse or
// preview route — the only shapes an unauthenticated visitor may open.
// The move picker and every management destination stay behind login.
function isAnonymousAllowed(pathname: string): boolean {
  const segments = pathname.split("/").filter((s) => s.length > 0);
  if (segments[0] !== "v" || segments.length < 2) return false;
  return segments[2] !== "move";
}

// Public routes (design D1/D3): the anonymous read-only world. It
// never mounts the application shell, so no Files / Uploads /
// Settings destination exists for an unauthenticated visitor; the
// PublicGate turns a non-public or unknown vdir into the login
// screen, fail-closed.
function PublicRoutes() {
  return (
    <Routes>
      <Route element={<PublicShell />}>
        <Route path="/v/:vdirId/view/*" element={<PublicGate><PreviewPage /></PublicGate>} />
        <Route path="/v/:vdirId/*" element={<PublicGate><BrowsePage /></PublicGate>} />
        <Route path="*" element={<LoginPage />} />
      </Route>
    </Routes>
  );
}

// PublicShell is the anonymous browsing chrome: just the scrollable
// content area — the browse/preview pages carry their own navigation.
function PublicShell() {
  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-ios-bg text-ios-label">
      <main className="min-h-0 flex-1 overflow-y-auto">
        <Outlet />
      </main>
    </div>
  );
}

export function AppRoutes() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route path="/" element={<Navigate to="/files" replace />} />
        <Route path="/files" element={<LocationsPage />} />
        <Route path="/v/:vdirId/view/*" element={<PreviewPage />} />
        <Route path="/v/:vdirId/move" element={<MovePickerPage />} />
        <Route path="/v/:vdirId/*" element={<BrowsePage />} />
        <Route path="/uploads" element={<UploadsPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/settings/connections" element={<ConnectionsPage />} />
        <Route path="/settings/connections/:id" element={<ConnectionFormPage />} />
        <Route path="/settings/vdirs" element={<VdirsPage />} />
        <Route path="/settings/vdirs/:id" element={<VdirFormPage />} />
        <Route path="/settings/vdirs/:id/sharing" element={<SharingPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
