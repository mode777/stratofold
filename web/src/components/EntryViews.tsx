// Virtualized entry rendering (design D9): TanStack Virtual windows
// both the iOS list and the 3-column grid; the full sorted array is in
// memory, only the visible window is DOM. Rows expose the primary tap
// (open/preview/new-tab), an ellipsis actions button, and a long-press
// / right-click context menu.

import { useRef, type PointerEvent as ReactPointerEvent } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { filesUrl, isMediaName, type LsEntry } from "../lib/filesApi";
import { formatModTime, formatSize } from "../lib/listing";
import { entryVisual } from "./entryVisual";
import { EllipsisIcon } from "./icons";

export type EntryMenuRequest = (entry: LsEntry, path: string) => void;

const ROW_HEIGHT = 56;

function useLongPress(onLongPress: () => void) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clear = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  return {
    onPointerDown: (e: ReactPointerEvent) => {
      if (e.button !== 0) return;
      clear();
      timer.current = setTimeout(onLongPress, 500);
    },
    onPointerUp: clear,
    onPointerMove: clear,
    onPointerLeave: clear,
    onContextMenu: (e: { preventDefault: () => void }) => {
      e.preventDefault();
      onLongPress();
    },
  };
}

function PrimaryTarget({
  vdirId,
  entry,
  path,
  onOpenDir,
  onPreview,
}: {
  vdirId: string;
  entry: LsEntry;
  path: string;
  onOpenDir: (path: string) => void;
  onPreview: (entry: LsEntry, path: string) => void;
}) {
  const cls = "flex min-w-0 flex-1 items-center gap-3 text-left";
  if (entry.dir) {
    return (
      <button type="button" data-testid="open-dir" onClick={() => onOpenDir(path)} className={cls}>
        <EntryIcon entry={entry} />
        <EntryName entry={entry} />
      </button>
    );
  }
  if (isMediaName(entry.name)) {
    return (
      <a
        href={filesUrl(vdirId, path)}
        target="_blank"
        rel="noopener"
        data-testid="open-media"
        className={cls}
      >
        <EntryIcon entry={entry} />
        <EntryName entry={entry} />
      </a>
    );
  }
  return (
    <button
      type="button"
      data-testid="open-preview"
      onClick={() => onPreview(entry, path)}
      className={cls}
    >
      <EntryIcon entry={entry} />
      <EntryName entry={entry} />
    </button>
  );
}

function EntryIcon({ entry, large = false }: { entry: LsEntry; large?: boolean }) {
  const visual = entryVisual(entry);
  return (
    <span
      className={`flex shrink-0 items-center justify-center rounded-lg ${
        large ? "h-12 w-12 text-2xl" : "h-8 w-8 text-base"
      } ${visual.tone}`}
    >
      <visual.Icon />
    </span>
  );
}

function EntryName({ entry }: { entry: LsEntry }) {
  return (
    <span className="min-w-0 flex-1">
      <span className="block truncate text-base font-semibold text-ios-label">{entry.name}</span>
      <span className="block text-xs text-ios-secondary/50">
        {entry.dir ? "Folder" : formatModTime(entry.modtime)}
      </span>
    </span>
  );
}

function ActionsButton({ entry, onMenu }: { entry: LsEntry; onMenu: () => void }) {
  return (
    <button
      type="button"
      data-testid="entry-actions"
      aria-label={`Actions for ${entry.name}`}
      onClick={onMenu}
      className="shrink-0 rounded-full p-2 text-ios-secondary/50 hover:bg-black/5"
    >
      <EllipsisIcon />
    </button>
  );
}

export function EntryList({
  vdirId,
  entries,
  paths,
  onOpenDir,
  onPreview,
  onMenu,
}: {
  vdirId: string;
  entries: LsEntry[];
  paths: string[];
  onOpenDir: (path: string) => void;
  onPreview: (entry: LsEntry, path: string) => void;
  onMenu: EntryMenuRequest;
}) {
  const scroll = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: entries.length,
    getScrollElement: () => scroll.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 8,
  });

  return (
    <div ref={scroll} data-testid="entry-scroll" className="h-full overflow-auto px-4 py-3">
      <div
        className="divide-y divide-ios-separator overflow-hidden rounded-2xl border border-black/5 bg-ios-card shadow-sm"
        style={{ height: virtualizer.getTotalSize(), position: "relative" }}
      >
        {virtualizer.getVirtualItems().map((item) => {
          const entry = entries[item.index];
          const path = paths[item.index];
          return (
            <EntryRow
              key={path}
              index={item.index}
              entry={entry}
              path={path}
              vdirId={vdirId}
              onOpenDir={onOpenDir}
              onPreview={onPreview}
              onMenu={onMenu}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                height: item.size,
                transform: `translateY(${item.start}px)`,
              }}
            />
          );
        })}
      </div>
      {/* Trailing spacer (design D4): the scroll area runs to the
          viewport bottom beneath the translucent tab bar; the spacer
          lets the last entry scroll fully above it. It sits outside
          the measured card, so the virtualizer is unaffected. */}
      <div aria-hidden="true" className="h-24 pb-safe" />
    </div>
  );
}

function EntryRow({
  index,
  entry,
  path,
  vdirId,
  onOpenDir,
  onPreview,
  onMenu,
  style,
}: {
  index: number;
  entry: LsEntry;
  path: string;
  vdirId: string;
  onOpenDir: (path: string) => void;
  onPreview: (entry: LsEntry, path: string) => void;
  onMenu: EntryMenuRequest;
  style: React.CSSProperties;
}) {
  const longPress = useLongPress(() => onMenu(entry, path));
  return (
    <div
      data-testid={`entry-${index}`}
      data-entry-name={entry.name}
      style={style}
      className="flex items-center gap-2 bg-ios-card px-4"
      {...longPress}
    >
      <PrimaryTarget vdirId={vdirId} entry={entry} path={path} onOpenDir={onOpenDir} onPreview={onPreview} />
      {!entry.dir && (
        <span
          data-testid="entry-size"
          className="shrink-0 text-sm font-medium text-ios-label"
        >
          {formatSize(entry.size)}
        </span>
      )}
      <ActionsButton entry={entry} onMenu={() => onMenu(entry, path)} />
    </div>
  );
}

const GRID_COLUMNS = 3;
const GRID_ROW_HEIGHT = 148;

export function EntryGrid({
  vdirId,
  entries,
  paths,
  onOpenDir,
  onPreview,
  onMenu,
}: {
  vdirId: string;
  entries: LsEntry[];
  paths: string[];
  onOpenDir: (path: string) => void;
  onPreview: (entry: LsEntry, path: string) => void;
  onMenu: EntryMenuRequest;
}) {
  const scroll = useRef<HTMLDivElement>(null);
  const rowCount = Math.ceil(entries.length / GRID_COLUMNS);
  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scroll.current,
    estimateSize: () => GRID_ROW_HEIGHT,
    overscan: 3,
  });

  return (
    <div ref={scroll} data-testid="entry-scroll" className="h-full overflow-auto p-4">
      <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
        {virtualizer.getVirtualItems().map((row) => {
          const first = row.index * GRID_COLUMNS;
          const cells = entries.slice(first, first + GRID_COLUMNS);
          return (
            <div
              key={row.index}
              data-testid={`grid-row-${row.index}`}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                height: row.size,
                transform: `translateY(${row.start}px)`,
              }}
              className="grid grid-cols-3 gap-3"
            >
              {cells.map((entry, col) => {
                const index = first + col;
                const path = paths[index];
                return (
                  <GridCell
                    key={path}
                    index={index}
                    entry={entry}
                    path={path}
                    vdirId={vdirId}
                    onOpenDir={onOpenDir}
                    onPreview={onPreview}
                    onMenu={onMenu}
                  />
                );
              })}
            </div>
          );
        })}
      </div>
      {/* Trailing spacer, same purpose as in EntryList (design D4). */}
      <div aria-hidden="true" className="h-24 pb-safe" />
    </div>
  );
}

function GridCell({
  index,
  entry,
  path,
  vdirId,
  onOpenDir,
  onPreview,
  onMenu,
}: {
  index: number;
  entry: LsEntry;
  path: string;
  vdirId: string;
  onOpenDir: (path: string) => void;
  onPreview: (entry: LsEntry, path: string) => void;
  onMenu: EntryMenuRequest;
}) {
  const longPress = useLongPress(() => onMenu(entry, path));
  const targetCls = "flex w-full flex-1 flex-col items-center justify-center gap-2 text-center";
  const body = (
    <>
      <EntryIcon entry={entry} large />
      <span className="line-clamp-2 text-xs font-semibold text-ios-label">{entry.name}</span>
    </>
  );
  return (
    <div
      data-testid={`entry-${index}`}
      data-entry-name={entry.name}
      className="relative flex aspect-square flex-col items-center justify-center rounded-xl border border-black/5 bg-ios-card p-3 shadow-sm active:scale-95"
      {...longPress}
    >
      {entry.dir ? (
        <button type="button" data-testid="open-dir" onClick={() => onOpenDir(path)} className={targetCls}>
          {body}
        </button>
      ) : isMediaName(entry.name) ? (
        <a
          href={filesUrl(vdirId, path)}
          target="_blank"
          rel="noopener"
          data-testid="open-media"
          className={targetCls}
        >
          {body}
        </a>
      ) : (
        <button type="button" data-testid="open-preview" onClick={() => onPreview(entry, path)} className={targetCls}>
          {body}
        </button>
      )}
      <div className="absolute top-1 right-1">
        <ActionsButton entry={entry} onMenu={() => onMenu(entry, path)} />
      </div>
    </div>
  );
}
