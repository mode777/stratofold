import { Navigate, Route, Routes } from "react-router";
import { SessionProvider, useSession } from "./lib/session";
import { AppShell } from "./components/AppShell";
import { EmptyState, FailureState, Spinner } from "./components/Errors";
import { useVdirs } from "./lib/useVdirs";
import { LoginPage } from "./pages/LoginPage";
import { BrowsePage } from "./pages/BrowsePage";
import { ConnectionsPage } from "./pages/ConnectionsPage";
import { VdirsPage } from "./pages/VdirsPage";
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
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route path="/" element={<HomeRedirect />} />
        <Route path="/v/:vdirId/*" element={<BrowsePage />} />
        <Route path="/connections" element={<ConnectionsPage />} />
        <Route path="/vdirs" element={<VdirsPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}

function HomeRedirect() {
  const { vdirs, failure, loading, reload } = useVdirs();
  if (loading) return <Spinner />;
  if (failure) return <FailureState failure={failure} onRetry={reload} />;
  if (vdirs.length > 0) return <Navigate to={`/v/${vdirs[0].id}`} replace />;
  return (
    <EmptyState
      title="No virtual directories yet"
      hint="Create a connection and a vdir to start browsing."
    />
  );
}
