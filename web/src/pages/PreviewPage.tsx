// File preview (web-ui spec, design D7): a pushed Quick-Look-style
// screen for a non-media file, showing client-derived name, size, and
// modified time from the directory listing, plus a download action.
// Media files never land here — they open in a new tab at /files.

import { useEffect, useMemo, useState } from "react";
import { useLocation, useParams } from "react-router";
import { filesUrl, ls, type ApiFailure, type LsEntry } from "../lib/filesApi";
import { decodeSplat, formatModTime, formatSize, parentPath } from "../lib/listing";
import { toApiFailure } from "../lib/records";
import { FailureState, Spinner } from "../components/Errors";
import { DownloadIcon } from "../components/icons";
import { entryVisual } from "../components/entryVisual";

export function PreviewPage() {
  const { vdirId = "" } = useParams();
  const { pathname } = useLocation();
  const path = useMemo(() => {
    const prefix = `/v/${vdirId}/view`;
    const raw = pathname.startsWith(prefix) ? pathname.slice(prefix.length) : "";
    return decodeSplat(raw);
  }, [pathname, vdirId]);

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

  if (loading) return <Spinner />;
  if (failure) return <FailureState failure={failure} onRetry={() => setAttempt((n) => n + 1)} />;
  if (!entry) return null;

  const visual = entryVisual(entry);

  return (
    <div data-testid="preview" className="flex min-h-dvh flex-col items-center px-6 py-8">
      <div className="flex h-40 w-32 flex-col items-center justify-center rounded-xl border border-ios-separator bg-ios-card shadow-md">
        <span className={`flex h-16 w-16 items-center justify-center rounded-2xl text-4xl ${visual.tone}`}>
          <visual.Icon />
        </span>
      </div>
      <h1 className="mt-5 max-w-full truncate text-base font-bold text-ios-label">{entry.name}</h1>
      <p className="mt-1 text-xs text-ios-secondary/60">
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
  );
}
