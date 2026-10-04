// Entry actions (web-ui spec): every file carries its plain /files
// URL; download fetches it; media opens in a NEW TAB at the URL where
// the browser's native player takes over (no player component here).
// All actions are native links/buttons — keyboard operable by default.
// `path` is the entry's full virtual path (current directory + name).

import { filesUrl, isMediaName, type LsEntry } from "../lib/filesApi";
import { browseUrl, formatModTime, formatSize } from "../lib/listing";

export function entryIcon(entry: LsEntry): string {
  return entry.dir ? "📁" : "📄";
}

export function FileNameLink({
  vdirId,
  entry,
  path,
  onOpenDir,
}: {
  vdirId: string;
  entry: LsEntry;
  path: string;
  onOpenDir?: (path: string) => void;
}) {
  if (entry.dir) {
    return (
      <button
        type="button"
        data-testid="open-dir"
        onClick={() => onOpenDir?.(path)}
        className="truncate text-left text-blue-700 hover:underline"
      >
        {entry.name}
      </button>
    );
  }
  const url = filesUrl(vdirId, path);
  if (isMediaName(entry.name)) {
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener"
        data-testid="open-media"
        className="truncate text-blue-700 hover:underline"
      >
        {entry.name}
      </a>
    );
  }
  return (
    <a
      href={url}
      download
      data-testid="download-link"
      className="truncate text-blue-700 hover:underline"
    >
      {entry.name}
    </a>
  );
}

export type EntryActionHandlers = {
  canWrite?: boolean;
  onRename?: (entry: LsEntry, path: string) => void;
  onMove?: (entry: LsEntry, path: string) => void;
  onDelete?: (entry: LsEntry, path: string) => void;
};

const actionCls = "rounded border border-gray-300 px-2 py-0.5 hover:bg-gray-50";

export function EntryActions({
  vdirId,
  entry,
  path,
  onOpenDir,
  handlers,
}: {
  vdirId: string;
  entry: LsEntry;
  path: string;
  onOpenDir?: (path: string) => void;
  handlers?: EntryActionHandlers;
}) {
  const url = filesUrl(vdirId, path);
  const media = !entry.dir && isMediaName(entry.name);
  return (
    <span className="flex shrink-0 items-center gap-2 text-xs">
      {entry.dir ? (
        <button
          type="button"
          data-testid="action-open-dir"
          onClick={() => onOpenDir?.(path)}
          className={actionCls}
        >
          Open
        </button>
      ) : (
        <>
          {media && (
            <a
              href={url}
              target="_blank"
              rel="noopener"
              data-testid="action-open-tab"
              className={actionCls}
            >
              Open in new tab
            </a>
          )}
          <a href={url} download data-testid="action-download" className={actionCls}>
            Download
          </a>
        </>
      )}
      {handlers?.canWrite && (
        <>
          <button
            type="button"
            data-testid="action-rename"
            onClick={() => handlers.onRename?.(entry, path)}
            className={actionCls}
          >
            Rename
          </button>
          <button
            type="button"
            data-testid="action-move"
            onClick={() => handlers.onMove?.(entry, path)}
            className={actionCls}
          >
            Move
          </button>
          <button
            type="button"
            data-testid="action-delete"
            onClick={() => handlers.onDelete?.(entry, path)}
            className="rounded border border-red-200 px-2 py-0.5 text-red-700 hover:bg-red-50"
          >
            Delete
          </button>
        </>
      )}
    </span>
  );
}

export function EntryMeta({ entry }: { entry: LsEntry }) {
  return (
    <>
      <span className="hidden w-20 shrink-0 text-right text-gray-500 sm:inline" data-testid="entry-size">
        {entry.dir ? "—" : formatSize(entry.size)}
      </span>
      <span
        className="hidden w-44 shrink-0 truncate text-right text-gray-500 md:inline"
        data-testid="entry-modtime"
      >
        {formatModTime(entry.modtime)}
      </span>
    </>
  );
}

export { browseUrl };
