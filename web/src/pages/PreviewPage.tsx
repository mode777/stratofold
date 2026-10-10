// File preview (web-ui spec): a pushed Quick-Look-style screen. The
// page owns the shared skeleton — header with back (fix-web-ui D1),
// the pre-flight directory lookup for client-derived metadata, and
// the failure states (not-available in public mode, design D3 of
// add-public-vdir-browsing) — and dispatches the body by file kind
// (add-audio-player-image-viewer D1): audio to the in-app player,
// images to the in-app viewer, everything else to the metadata card.
// Video never lands here — it opens in a new tab at /files.

import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router";
import { ls, type ApiFailure, type LsEntry } from "../lib/filesApi";
import { entryKind } from "../lib/entryKind";
import { browseUrl, decodeSplat, parentPath } from "../lib/listing";
import { toApiFailure } from "../lib/records";
import { FailureState, Spinner, UnavailableState } from "../components/Errors";
import { MetadataCard } from "../components/MetadataCard";
import { usePublicBrowseName } from "../components/PublicGate";
import { ChevronLeftIcon } from "../components/icons";
import { AudioPlayerPage } from "./AudioPlayerPage";
import { ImageViewerPage } from "./ImageViewerPage";

export function PreviewPage() {
  const { vdirId = "" } = useParams();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const path = useMemo(() => {
    const prefix = `/v/${vdirId}/view`;
    const raw = pathname.startsWith(prefix) ? pathname.slice(prefix.length) : "";
    return decodeSplat(raw);
  }, [pathname, vdirId]);

  // Public mode (design D3): anonymous previews render the same view
  // but map every failure to the not-available state — the entry may
  // have vanished with the vdir's publicness.
  const publicName = usePublicBrowseName();
  const publicMode = publicName !== null;

  const [entry, setEntry] = useState<LsEntry | null>(null);
  const [failure, setFailure] = useState<ApiFailure | null>(null);
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);

  const name = path.split("/").filter(Boolean).pop() ?? "";

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void ls(vdirId, parentPath(path))
      .then((found) => {
        if (cancelled) return;
        const match = found.find((e) => e.name === name);
        if (match) {
          setEntry(match);
          setFailure(null);
        } else {
          setFailure(toApiFailure(new Error("Not found.")));
        }
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
  }, [vdirId, path, name, attempt]);

  const goBack = () => void navigate(browseUrl(vdirId, parentPath(path)));

  // The header stays across states (like BrowsePage's) — back must be
  // reachable even when the entry failed to load. pb-24 md:pb-0 keeps
  // the content clear of the mobile tab bar (design D4).
  const header = (
    <div className="px-4 pt-1 pb-2">
      <button
        type="button"
        data-testid="back"
        onClick={goBack}
        className="flex items-center text-base text-ios-blue"
      >
        <ChevronLeftIcon className="mr-0.5 text-sm" />
        Back
      </button>
      <h1 className="mt-0.5 truncate text-[30px] font-bold leading-tight tracking-tight text-ios-label">
        {name}
      </h1>
    </div>
  );

  if (loading)
    return (
      <div data-testid="preview" className="flex min-h-dvh flex-col pb-24 md:pb-0">
        {header}
        <Spinner />
      </div>
    );
  if (failure)
    return (
      <div data-testid="preview" className="flex min-h-dvh flex-col pb-24 md:pb-0">
        {header}
        {publicMode ? (
          <UnavailableState onSignIn={() => void navigate("/")} />
        ) : (
          <FailureState failure={failure} onRetry={() => setAttempt((n) => n + 1)} />
        )}
      </div>
    );
  if (!entry) return null;

  const kind = entryKind(entry.name, entry.dir);

  return (
    <div data-testid="preview" className="flex min-h-dvh flex-col pb-24 md:pb-0">
      {header}
      {kind === "audio" ? (
        <AudioPlayerPage vdirId={vdirId} path={path} />
      ) : kind === "image" ? (
        <ImageViewerPage vdirId={vdirId} path={path} entry={entry} />
      ) : (
        <MetadataCard vdirId={vdirId} path={path} entry={entry} />
      )}
    </div>
  );
}
