// Long-press / ellipsis context menu (web-ui spec): role-gated entry
// actions in an iOS action menu. Open and Download for everyone —
// open leads in-app (player for audio, viewer for images, Quick Look
// for other files). Video also keeps a separate open-in-new-tab action
// for the raw /files URL. On a public vdir a
// file offers Copy public link: the absolute /files URL that already
// downloads it anonymously (no token; un-publishing revokes it). On a
// non-public vdir, a signed-in reader instead offers Copy 24-hour link,
// which mints a session-free /s/<token> URL (add-expiring-file-links).
// Rename/Move/Delete are writer-only.

import { useEffect, useState, type ReactElement, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { filesUrl, type LsEntry } from "../lib/filesApi";
import { entryKind } from "../lib/entryKind";
import {
  ChevronRightIcon,
  DownloadIcon,
  FolderIcon,
  LinkIcon,
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
      <Icon
        className={destructive ? "text-ios-red" : "text-ios-secondary/50"}
      />
    </>
  );
  if (href) {
    return (
      <a
        href={href}
        target={target}
        rel={target ? "noopener" : undefined}
        download={download}
        data-testid={testid}
        className={cls}
      >
        {inner}
      </a>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testid}
      className={cls}
    >
      {inner}
    </button>
  );
}

export function ContextMenu({
  entry,
  path,
  vdirId,
  canWrite,
  isPublic = false,
  canMintLink = false,
  onCopyTemporaryLink,
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
  isPublic?: boolean;
  canMintLink?: boolean;
  onCopyTemporaryLink?: (path: string) => Promise<boolean>;
  onOpenDir?: (path: string) => void;
  onPreview?: (entry: LsEntry, path: string) => void;
  onRename: (entry: LsEntry, path: string) => void;
  onMove: (entry: LsEntry, path: string) => void;
  onDelete: (entry: LsEntry, path: string) => void;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [tempCopied, setTempCopied] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const url = filesUrl(vdirId, path);
  const kind = entryKind(entry.name, entry.dir);
  const visual = entryVisual(entry);

  // The link is the absolute form of the Download URL, so it works
  // outside this tab (design D2). Success is claimed only when the
  // clipboard write settles; an unavailable or rejected clipboard
  // leaves the row unchanged (design D4).
  const copyPublicLink = async () => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${url}`);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  // The temporary-link mint/copy is owned by the page (it has the
  // session and vdir context); the menu only reflects the outcome and
  // never claims success on its own.
  const copyTemporaryLink = async () => {
    if (!onCopyTemporaryLink) return;
    try {
      setTempCopied((await onCopyTemporaryLink(path)) === true);
    } catch {
      setTempCopied(false);
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex flex-col justify-end bg-black/40 p-4 pb-12 backdrop-blur-sm"
      data-testid="context-backdrop"
      onClick={onClose}
    >
      <div onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center gap-3 rounded-2xl border border-black/10 bg-ios-card p-4 shadow-2xl">
          <span
            className={`flex h-10 w-10 items-center justify-center rounded-xl text-lg ${visual.tone}`}
          >
            <visual.Icon />
          </span>
          <span className="min-w-0">
            <span className="block truncate text-base font-bold text-ios-label">
              {entry.name}
            </span>
            <span className="block text-xs text-ios-secondary/60">
              {entry.dir
                ? "Folder"
                : kind === "audio"
                  ? "Audio"
                  : kind === "image"
                    ? "Image"
                    : kind === "video"
                      ? "Video"
                      : "File"}
            </span>
          </span>
        </div>

        <div
          data-testid="context-menu"
          className="mb-3 divide-y divide-ios-separator overflow-hidden rounded-2xl border border-black/10 bg-ios-card/95 text-base shadow-xl backdrop-blur"
        >
          {entry.dir ? (
            <MenuItem
              label="Open"
              testid="action-open"
              Icon={ChevronRightIcon}
              onClick={() => onOpenDir?.(path)}
            />
          ) : (
            <>
              <MenuItem
                label="Open"
                testid="action-open"
                Icon={ChevronRightIcon}
                onClick={() => onPreview?.(entry, path)}
              />
              {kind === "video" && (
                <MenuItem
                  label="Open in new tab"
                  testid="action-open-tab"
                  Icon={ChevronRightIcon}
                  href={url}
                  target="_blank"
                />
              )}
              <MenuItem
                label="Download"
                testid="action-download"
                Icon={DownloadIcon}
                href={url}
                download
              />
            </>
          )}
          {/* Public file link (design D3): files only — a folder URL
              streams a listing, and the vdir browse link covers that. */}
          {!entry.dir && isPublic && (
            <MenuItem
              label={copied ? "Copied" : "Copy public link"}
              testid="action-copy-public-link"
              Icon={LinkIcon}
              onClick={() => void copyPublicLink()}
            />
          )}
          {/* Non-public vdirs offer the minted 24-hour link instead
              (design D11); public vdirs keep the permanent link. */}
          {!entry.dir && canMintLink && onCopyTemporaryLink && (
            <MenuItem
              label={tempCopied ? "Copied" : "Copy 24-hour link"}
              testid="action-copy-temp-link"
              Icon={LinkIcon}
              onClick={() => void copyTemporaryLink()}
            />
          )}
          {canWrite && (
            <>
              <MenuItem
                label="Rename…"
                testid="action-rename"
                Icon={PencilIcon}
                onClick={() => onRename(entry, path)}
              />
              <MenuItem
                label="Move…"
                testid="action-move"
                Icon={FolderIcon}
                onClick={() => onMove(entry, path)}
              />
              <MenuItem
                label="Delete"
                testid="action-delete"
                Icon={TrashIcon}
                destructive
                onClick={() => onDelete(entry, path)}
              />
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
