// Long-press / ellipsis context menu (web-ui spec): role-gated entry
// actions in an iOS action menu. Open and Download for everyone, media
// also opens in a new tab, and Rename/Move/Delete only for writers.

import { useEffect, type ReactElement, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { filesUrl, isMediaName, type LsEntry } from "../lib/filesApi";
import {
  ChevronRightIcon,
  DownloadIcon,
  FolderIcon,
  PencilIcon,
  TrashIcon,
  type IconProps,
} from "./icons";
import { entryVisual } from "./entryVisual";

function MenuItem({
  label,
  onClick,
  href,
  target,
  download,
  testid,
  destructive,
  Icon,
}: {
  label: string;
  onClick?: () => void;
  href?: string;
  target?: string;
  download?: boolean;
  testid: string;
  destructive?: boolean;
  Icon: (p: IconProps) => ReactElement;
}) {
  const cls = `flex w-full items-center justify-between px-5 py-3.5 text-left text-base hover:bg-black/5 ${
    destructive ? "font-medium text-ios-red" : "text-ios-label"
  }`;
  const inner: ReactNode = (
    <>
      <span>{label}</span>
      <Icon className={destructive ? "text-ios-red" : "text-ios-secondary/50"} />
    </>
  );
  if (href) {
    return (
      <a href={href} target={target} rel={target ? "noopener" : undefined} download={download} data-testid={testid} className={cls}>
        {inner}
      </a>
    );
  }
  return (
    <button type="button" onClick={onClick} data-testid={testid} className={cls}>
      {inner}
    </button>
  );
}

export function ContextMenu({
  entry,
  path,
  vdirId,
  canWrite,
  onOpenDir,
  onPreview,
  onRename,
  onMove,
  onDelete,
  onClose,
}: {
  entry: LsEntry;
  path: string;
  vdirId: string;
  canWrite: boolean;
  onOpenDir?: (path: string) => void;
  onPreview?: (entry: LsEntry, path: string) => void;
  onRename: (entry: LsEntry, path: string) => void;
  onMove: (entry: LsEntry, path: string) => void;
  onDelete: (entry: LsEntry, path: string) => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const url = filesUrl(vdirId, path);
  const media = !entry.dir && isMediaName(entry.name);
  const visual = entryVisual(entry);

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex flex-col justify-end bg-black/40 p-4 pb-12 backdrop-blur-sm"
      data-testid="context-backdrop"
      onClick={onClose}
    >
      <div onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center gap-3 rounded-2xl border border-black/10 bg-ios-card p-4 shadow-2xl">
          <span className={`flex h-10 w-10 items-center justify-center rounded-xl text-lg ${visual.tone}`}>
            <visual.Icon />
          </span>
          <span className="min-w-0">
            <span className="block truncate text-base font-bold text-ios-label">{entry.name}</span>
            <span className="block text-xs text-ios-secondary/60">
              {entry.dir ? "Folder" : media ? "Media" : "File"}
            </span>
          </span>
        </div>

        <div
          data-testid="context-menu"
          className="mb-3 divide-y divide-ios-separator overflow-hidden rounded-2xl border border-black/10 bg-ios-card/95 text-base shadow-xl backdrop-blur"
        >
          {entry.dir ? (
            <MenuItem label="Open" testid="action-open" Icon={ChevronRightIcon} onClick={() => onOpenDir?.(path)} />
          ) : (
            <>
              {!media && (
                <MenuItem
                  label="Open"
                  testid="action-open"
                  Icon={ChevronRightIcon}
                  onClick={() => onPreview?.(entry, path)}
                />
              )}
              {media && (
                <MenuItem label="Open in new tab" testid="action-open-tab" Icon={ChevronRightIcon} href={url} target="_blank" />
              )}
              <MenuItem label="Download" testid="action-download" Icon={DownloadIcon} href={url} download />
            </>
          )}
          {canWrite && (
            <>
              <MenuItem label="Rename…" testid="action-rename" Icon={PencilIcon} onClick={() => onRename(entry, path)} />
              <MenuItem label="Move…" testid="action-move" Icon={FolderIcon} onClick={() => onMove(entry, path)} />
              <MenuItem label="Delete" testid="action-delete" Icon={TrashIcon} destructive onClick={() => onDelete(entry, path)} />
            </>
          )}
        </div>

        <button
          type="button"
          data-testid="context-dismiss"
          onClick={onClose}
          className="w-full rounded-2xl bg-ios-card py-3.5 text-base font-semibold text-ios-label shadow-md"
        >
          Dismiss
        </button>
      </div>
    </div>,
    document.body,
  );
}
