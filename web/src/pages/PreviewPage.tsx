// File preview (web-ui spec): a pushed Quick-Look-style screen. The
// page owns the shared skeleton — header with back (fix-web-ui D1),
// the pre-flight directory lookup for client-derived metadata, and
// the failure states (not-available in public mode, design D3 of
// add-public-vdir-browsing) — and dispatches the body by file kind
// (add-audio-player-image-viewer D1): audio to the in-app player,
// images to the in-app fullscreen gallery (add-fullscreen-image-gallery),
// everything else to the metadata card. Video never lands here — it
// opens in a new tab at /files.

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

  const dir = parentPath(path);
  const name = path.split("/").filter(Boolean).pop() ?? "";

  const [listing, setListing] = useState<LsEntry[] | null>(null);
  const [failure, setFailure] = useState<ApiFailure | null>(null);
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);

  // Pre-flight directory lookup, keyed by containing directory rather
  // than full path (add-fullscreen-image-gallery 1.2): the gallery's
  // swipe navigation replaces the path within the same directory and
  // must not refetch the listing; a different directory (or a retry)
  // still does.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setFailure(null);
    setListing(null);
    void ls(vdirId, dir)
      .then((found) => {
        if (cancelled) return;
        setListing(found);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setFailure(toApiFailure(err));
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [vdirId, dir, attempt]);

  // The entry derives from the held listing, so in-directory path
  // changes resolve without any request; a path missing from the
  // listing (deleted between fetch and render) is not-found.
  const entry = useMemo(() => listing?.find((e) => e.name === name) ?? null, [listing, name]);

  const goBack = () => void navigate(browseUrl(vdirId, dir));

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
  if (failure || !entry)
    return (
      <div data-testid="preview" className="flex min-h-dvh flex-col pb-24 md:pb-0">
        {header}
        {publicMode ? (
          <UnavailableState onSignIn={() => void navigate("/")} />
        ) : (
          <FailureState
            failure={failure ?? toApiFailure(new Error("Not found."))}
            onRetry={() => setAttempt((n) => n + 1)}
          />
        )}
      </div>
    );

  const kind = entryKind(entry.name, entry.dir);

  return (
    <div data-testid="preview" className="flex min-h-dvh flex-col pb-24 md:pb-0">
      {header}
      {kind === "audio" ? (
        <AudioPlayerPage vdirId={vdirId} path={path} />
      ) : kind === "image" ? (
        <ImageViewerPage vdirId={vdirId} path={path} entry={entry} listing={listing ?? []} />
      ) : (
        <MetadataCard vdirId={vdirId} path={path} entry={entry} />
      )}
    </div>
  );
}
