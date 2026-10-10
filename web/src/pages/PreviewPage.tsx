// File preview (web-ui spec, design D7): a pushed Quick-Look-style
// screen for a non-media file, showing client-derived name, size, and
// modified time from the directory listing, plus a download action.
// Media files never land here — they open in a new tab at /files.
// The header (back + file name, fix-web-ui-and-session-lifetime D1)
// mirrors BrowsePage's and walks the directory tree: back opens the
// containing directory's listing, at any nesting depth.

import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router";
import { filesUrl, ls, type ApiFailure, type LsEntry } from "../lib/filesApi";
import { browseUrl, decodeSplat, formatModTime, formatSize, parentPath } from "../lib/listing";
import { toApiFailure } from "../lib/records";
import { FailureState, Spinner, UnavailableState } from "../components/Errors";
import { usePublicBrowseName } from "../components/PublicGate";
import { ChevronLeftIcon, DownloadIcon } from "../components/icons";
import { entryVisual } from "../components/entryVisual";

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

  const visual = entryVisual(entry);

  return (
    <div data-testid="preview" className="flex min-h-dvh flex-col pb-24 md:pb-0">
      {header}
      <div className="flex flex-1 flex-col items-center px-6 py-8">
        <div className="flex h-40 w-32 flex-col items-center justify-center rounded-xl border border-ios-separator bg-ios-card shadow-md">
          <span className={`flex h-16 w-16 items-center justify-center rounded-2xl text-4xl ${visual.tone}`}>
            <visual.Icon />
          </span>
        </div>
        <p className="mt-2 text-xs text-ios-secondary/60">
          {formatSize(entry.size)} · Modified {formatModTime(entry.modtime)}
        </p>

        <div className="mt-6 w-full max-w-xs space-y-1.5 rounded-2xl border border-black/5 bg-ios-card p-4 text-left text-xs text-ios-secondary/70 shadow-sm">
          <div className="flex justify-between">
            <span>Type</span>
            <span className="font-semibold text-ios-label">{entry.dir ? "Folder" : "File"}</span>
          </div>
          <div className="flex justify-between">
            <span>Size</span>
            <span className="font-semibold text-ios-label">{formatSize(entry.size)}</span>
          </div>
          <div className="flex justify-between">
            <span>Modified</span>
            <span className="font-semibold text-ios-label">{formatModTime(entry.modtime)}</span>
          </div>
        </div>

        <a
          href={filesUrl(vdirId, path)}
          download
          data-testid="preview-download"
          className="mt-8 flex w-full max-w-xs items-center justify-center gap-2 rounded-xl bg-ios-blue py-3.5 font-semibold text-white shadow-sm active:scale-95"
        >
          <DownloadIcon /> Download
        </a>
      </div>
    </div>
  );
}
