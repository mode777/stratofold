import { Navigate, Route, Routes } from "react-router";
import { SessionProvider, useSession } from "./lib/session";
import { Spinner } from "./components/Errors";
import { AppShell } from "./components/AppShell";
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
// login screen; a rejected session flips state and lands them back
// there from anywhere.
function SessionGate() {
  const { state } = useSession();
  if (state === "checking") return <Spinner label="Checking session…" />;
  if (state === "anonymous") return <LoginPage />;
  return <AppRoutes />;
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
