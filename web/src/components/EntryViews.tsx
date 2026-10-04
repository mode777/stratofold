// Virtualized entry rendering (design D4): TanStack Virtual windows
// both views — list rows and grid rows (chunks of columns). The full
// sorted array is held in memory; only the visible window is DOM.

import { useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { LsEntry } from "../lib/filesApi";
import {
  EntryActions,
  EntryMeta,
  FileNameLink,
  entryIcon,
  type EntryActionHandlers,
} from "./EntryLinks";

export type EntryHandlers = {
  onOpenDir: (path: string) => void;
};

const ROW_HEIGHT = 44;

export function EntryList({
  vdirId,
  entries,
  paths,
  onOpenDir,
  handlers,
}: {
  vdirId: string;
  entries: LsEntry[];
  paths: string[];
  onOpenDir: (path: string) => void;
  handlers?: EntryActionHandlers;
}) {
  const scroll = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: entries.length,
    getScrollElement: () => scroll.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 8,
  });

  return (
    <div ref={scroll} data-testid="entry-scroll" className="h-full overflow-auto">
      <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
        {virtualizer.getVirtualItems().map((item) => {
          const entry = entries[item.index];
          const path = paths[item.index];
          return (
            <div
              key={path}
              data-testid={`entry-${item.index}`}
              data-entry-name={entry.name}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                height: item.size,
                transform: `translateY(${item.start}px)`,
              }}
              className="flex items-center gap-3 border-b border-gray-100 px-3"
            >
              <span aria-hidden="true">{entryIcon(entry)}</span>
              <span className="min-w-0 flex-1">
                <FileNameLink vdirId={vdirId} entry={entry} path={path} onOpenDir={onOpenDir} />
              </span>
              <EntryMeta entry={entry} />
              <EntryActions
                vdirId={vdirId}
                entry={entry}
                path={path}
                onOpenDir={onOpenDir}
                handlers={handlers}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

const GRID_COLUMNS = 4;
const GRID_ROW_HEIGHT = 148;

export function EntryGrid({
  vdirId,
  entries,
  paths,
  onOpenDir,
  handlers,
}: {
  vdirId: string;
  entries: LsEntry[];
  paths: string[];
  onOpenDir: (path: string) => void;
  handlers?: EntryActionHandlers;
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
    <div ref={scroll} data-testid="entry-scroll" className="h-full overflow-auto">
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
              className="grid grid-cols-2 gap-2 px-3 sm:grid-cols-4"
            >
              {cells.map((entry, col) => {
                const index = first + col;
                const path = paths[index];
                return (
                  <div
                    key={path}
                    data-testid={`entry-${index}`}
                    data-entry-name={entry.name}
                    className="flex h-36 flex-col items-center justify-center gap-2 rounded border border-gray-200 p-2"
                  >
                    <span aria-hidden="true" className="text-2xl">
                      {entryIcon(entry)}
                    </span>
                    <span className="w-full min-w-0 text-center text-sm">
                      <FileNameLink vdirId={vdirId} entry={entry} path={path} onOpenDir={onOpenDir} />
                    </span>
                    <EntryActions
                      vdirId={vdirId}
                      entry={entry}
                      path={path}
                      onOpenDir={onOpenDir}
                      handlers={handlers}
                    />
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
