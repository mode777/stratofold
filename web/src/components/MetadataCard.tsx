// Quick-Look metadata card (web-ui spec): the client-derived name,
// size, and modified time of a file plus its download action. Shared
// by the preview dispatcher (non-media files) and the image viewer's
// decode fallback (add-audio-player-image-viewer design D5).

import { filesUrl, type LsEntry } from "../lib/filesApi";
import { formatModTime, formatSize } from "../lib/listing";
import { DownloadIcon } from "./icons";
import { entryVisual } from "./entryVisual";

export function MetadataCard({ vdirId, path, entry }: { vdirId: string; path: string; entry: LsEntry }) {
  const visual = entryVisual(entry);
  return (
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
  );
}
