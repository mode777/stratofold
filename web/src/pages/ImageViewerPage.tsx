// In-app image viewer (web-ui spec, add-audio-player-image-viewer
// D5): renders the image itself from the file's plain /files URL. The
// bytes are fetched with the session cookie and shown through an
// object URL so request failures (the fetch) stay distinguishable from
// decode failures (the <img> error): the former render the retryable
// failure state, the latter fall back to the metadata card — no
// broken frame for formats the browser cannot decode (HEIC, DNG).

import { useEffect, useState } from "react";
import { ApiFailure, filesUrl, sfFetch, type LsEntry } from "../lib/filesApi";
import { toApiFailure } from "../lib/records";
import { FailureState, Spinner } from "../components/Errors";
import { MetadataCard } from "../components/MetadataCard";
import { DownloadIcon } from "../components/icons";
import { formatModTime, formatSize } from "../lib/listing";

export function ImageViewerPage({
  vdirId,
  path,
  entry,
}: {
  vdirId: string;
  path: string;
  entry: LsEntry;
}) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [failure, setFailure] = useState<ApiFailure | null>(null);
  const [decodeFailed, setDecodeFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  const name = path.split("/").filter(Boolean).pop() ?? "";
  const url = filesUrl(vdirId, path);

  useEffect(() => {
    let cancelled = false;
    let created: string | null = null;
    setFailure(null);
    setDecodeFailed(false);
    setObjectUrl(null);
    sfFetch(url)
      .then(async (resp) => {
        const blob = await resp.blob();
        if (cancelled) return;
        created = URL.createObjectURL(blob);
        setObjectUrl(created);
      })
      .catch((err: unknown) => {
        if (!cancelled) setFailure(err instanceof ApiFailure ? err : toApiFailure(err));
      });
    return () => {
      cancelled = true;
      if (created) URL.revokeObjectURL(created);
    };
  }, [url, attempt]);

  if (failure) {
    return <FailureState failure={failure} onRetry={() => setAttempt((n) => n + 1)} />;
  }

  // Decode fallback (design D5): the bytes arrived but the browser
  // cannot render them — the metadata card (with its Download) takes
  // over instead of a broken image frame.
  if (decodeFailed) {
    return <MetadataCard vdirId={vdirId} path={path} entry={entry} />;
  }

  return (
    <div className="flex flex-1 flex-col items-center px-6 py-8">
      {objectUrl ? (
        <img
          src={objectUrl}
          alt={name}
          data-testid="image-frame"
          onError={() => setDecodeFailed(true)}
          className="max-h-[50dvh] max-w-full rounded-xl border border-ios-separator bg-ios-card object-contain shadow-md"
        />
      ) : (
        <div className="flex h-40 w-32 items-center justify-center rounded-xl border border-ios-separator bg-ios-card shadow-md">
          <Spinner label="Loading image…" />
        </div>
      )}

      <p className="mt-2 text-xs text-ios-secondary/60">
        {formatSize(entry.size)} · Modified {formatModTime(entry.modtime)}
      </p>

      <a
        href={url}
        download
        data-testid="preview-download"
        className="mt-8 flex w-full max-w-xs items-center justify-center gap-2 rounded-xl bg-ios-blue py-3.5 font-semibold text-white shadow-sm active:scale-95"
      >
        <DownloadIcon /> Download
      </a>
    </div>
  );
}
