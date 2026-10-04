// Browse view (design D5): one vdir's directory listing at the splat
// path — breadcrumbs, list/grid toggle, sorting, virtualized entries;
// the deterministic error classes render as distinct states with a
// retry action on 503 (reload).

import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { useLocation, useNavigate, useParams } from "react-router";
import { ls, type LsEntry } from "../lib/filesApi";
import { browseUrl, decodeSplat, joinPath, sortEntries, type SortDir, type SortKey } from "../lib/listing";
import { listVdirs, toApiFailure, type VdirRecord } from "../lib/records";
import { uploadQueue } from "../lib/uploadQueue";
import { useVdirRole } from "../lib/useVdirRole";
import { Breadcrumbs } from "../components/Breadcrumbs";
import { DeleteDialog, MkdirDialog, MoveDialog, RenameDialog } from "../components/FileOpsDialogs";
import { EmptyState, FailureState, Spinner } from "../components/Errors";
import { EntryGrid, EntryList } from "../components/EntryViews";
import type { EntryActionHandlers } from "../components/EntryLinks";
import type { ApiFailure } from "../lib/filesApi";

type ViewMode = "list" | "grid";

type FileOp =
  | { kind: "mkdir" }
  | { kind: "rename" | "move" | "delete"; entry: LsEntry; path: string };

function loadView(): ViewMode {
  return localStorage.getItem("sf.view") === "grid" ? "grid" : "list";
}

export function BrowsePage() {
  const { vdirId } = useParams();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const path = useMemo(() => {
    const prefix = `/v/${vdirId}`;
    const raw = pathname.startsWith(prefix) ? pathname.slice(prefix.length) : "";
    return decodeSplat(raw);
  }, [pathname, vdirId]);

  const [view, setView] = useState<ViewMode>(loadView);
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const [entries, setEntries] = useState<LsEntry[]>([]);
  const [failure, setFailure] = useState<ApiFailure | null>(null);
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);

  const [vdir, setVdir] = useState<VdirRecord | null>(null);
  const [op, setOp] = useState<FileOp | null>(null);
  const { canWrite } = useVdirRole(vdir);
  const vdirName = vdir?.name ?? "";

  useEffect(() => {
    let cancelled = false;
    if (!vdirId) return;
    setLoading(true);
    void ls(vdirId, path)
      .then((found) => {
        if (!cancelled) {
          setEntries(found);
          setFailure(null);
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
  }, [vdirId, path, attempt]);

  useEffect(() => {
    let cancelled = false;
    if (!vdirId) return;
    void listVdirs()
      .then((all) => {
        if (!cancelled) setVdir(all.find((v) => v.id === vdirId) ?? null);
      })
      .catch(() => {
        // The switcher surfaces vdir-list failures; here the record is
        // only used for the name and the write-permission derivation.
      });
    return () => {
      cancelled = true;
    };
  }, [vdirId]);

  const sorted = useMemo(() => sortEntries(entries, sortKey, sortDir), [entries, sortKey, sortDir]);
  const paths = useMemo(() => sorted.map((e) => joinPath(path, e.name)), [sorted, path]);

  const switchView = (mode: ViewMode) => {
    setView(mode);
    localStorage.setItem("sf.view", mode);
  };

  const toggleDirection = () => setSortDir((d) => (d === "asc" ? "desc" : "asc"));

  const reload = () => setAttempt((n) => n + 1);
  const finishOp = () => {
    setOp(null);
    reload();
  };

  const uploadInput = useRef<HTMLInputElement>(null);
  const onUpload = (e: ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (vdirId && files && files.length > 0) {
      uploadQueue.enqueue(vdirId, path, Array.from(files));
    }
    e.target.value = "";
  };

  const handlers: EntryActionHandlers = {
    canWrite,
    onRename: (entry, entryPath) => setOp({ kind: "rename", entry, path: entryPath }),
    onMove: (entry, entryPath) => setOp({ kind: "move", entry, path: entryPath }),
    onDelete: (entry, entryPath) => setOp({ kind: "delete", entry, path: entryPath }),
  };

  return (
    <div className="flex h-[calc(100dvh-3.5rem)] flex-col">
      <Breadcrumbs vdirId={vdirId ?? ""} vdirName={vdirName} path={path} />

      <div className="flex items-center gap-2 border-b border-gray-200 px-3 py-2" data-testid="toolbar">
        <label htmlFor="sort-key" className="text-sm text-gray-500">
          Sort
        </label>
        <select
          id="sort-key"
          data-testid="sort-key"
          value={sortKey}
          onChange={(e) => setSortKey(e.target.value as SortKey)}
          className="rounded border border-gray-300 px-2 py-1 text-sm"
        >
          <option value="name">Name</option>
          <option value="size">Size</option>
          <option value="modified">Modified</option>
        </select>
        <button
          type="button"
          data-testid="sort-direction"
          onClick={toggleDirection}
          aria-label={sortDir === "asc" ? "Sorted ascending; switch to descending" : "Sorted descending; switch to ascending"}
          className="rounded border border-gray-300 px-2 py-1 text-sm hover:bg-gray-50"
        >
          {sortDir === "asc" ? "↑ Asc" : "↓ Desc"}
        </button>
        {canWrite && (
          <>
            <button
              type="button"
              data-testid="new-folder"
              onClick={() => setOp({ kind: "mkdir" })}
              className="rounded border border-gray-300 px-2 py-1 text-sm hover:bg-gray-50"
            >
              New folder
            </button>
            <button
              type="button"
              data-testid="upload-button"
              onClick={() => uploadInput.current?.click()}
              className="rounded border border-gray-300 px-2 py-1 text-sm hover:bg-gray-50"
            >
              Upload
            </button>
            <input
              ref={uploadInput}
              type="file"
              multiple
              data-testid="upload-input"
              onChange={onUpload}
              className="hidden"
            />
          </>
        )}
        <span className="ml-auto flex overflow-hidden rounded border border-gray-300 text-sm">
          <button
            type="button"
            data-testid="view-list"
            aria-pressed={view === "list"}
            onClick={() => switchView("list")}
            className={`px-3 py-1 ${view === "list" ? "bg-blue-50 text-blue-700" : "hover:bg-gray-50"}`}
          >
            List
          </button>
          <button
            type="button"
            data-testid="view-grid"
            aria-pressed={view === "grid"}
            onClick={() => switchView("grid")}
            className={`px-3 py-1 ${view === "grid" ? "bg-blue-50 text-blue-700" : "hover:bg-gray-50"}`}
          >
            Grid
          </button>
        </span>
      </div>

      <div className="min-h-0 flex-1">
        {loading ? (
          <Spinner label="Loading directory…" />
        ) : failure ? (
          <FailureState failure={failure} onRetry={reload} />
        ) : sorted.length === 0 ? (
          <EmptyState title="This directory is empty" />
        ) : view === "list" ? (
          <EntryList
            vdirId={vdirId ?? ""}
            entries={sorted}
            paths={paths}
            onOpenDir={(next) => navigate(browseUrl(vdirId ?? "", next))}
            handlers={handlers}
          />
        ) : (
          <EntryGrid
            vdirId={vdirId ?? ""}
            entries={sorted}
            paths={paths}
            onOpenDir={(next) => navigate(browseUrl(vdirId ?? "", next))}
            handlers={handlers}
          />
        )}
      </div>

      {op?.kind === "mkdir" && (
        <MkdirDialog vdirId={vdirId ?? ""} dir={path} onClose={() => setOp(null)} onDone={finishOp} />
      )}
      {(op?.kind === "rename" || op?.kind === "move" || op?.kind === "delete") && (
        <>
          {op.kind === "rename" && (
            <RenameDialog
              vdirId={vdirId ?? ""}
              entry={op.entry}
              path={op.path}
              onClose={() => setOp(null)}
              onDone={finishOp}
            />
          )}
          {op.kind === "move" && (
            <MoveDialog
              vdirId={vdirId ?? ""}
              entry={op.entry}
              path={op.path}
              onClose={() => setOp(null)}
              onDone={finishOp}
            />
          )}
          {op.kind === "delete" && (
            <DeleteDialog
              vdirId={vdirId ?? ""}
              entry={op.entry}
              path={op.path}
              onClose={() => setOp(null)}
              onDone={finishOp}
            />
          )}
        </>
      )}
    </div>
  );
}
