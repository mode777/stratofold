// Browse view (web-ui spec, design D4/D9): one vdir's directory listing
// at the splat path — iOS nav bar with back control, folder title, and
// breadcrumb path plus the writer-only New / Upload actions (design D3
// of fix-web-ui-and-session-lifetime), a compact view toolbar (sort,
// list/grid), virtualized list/grid entries, a long-press context menu,
// and the file-operation overlays. The deterministic error classes
// render as distinct states with a retry action on 503.

import { useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent } from "react";
import { useLocation, useNavigate } from "react-router";
import { ls, mintFileLink, type LsEntry } from "../lib/filesApi";
import { bulkDelete, type BulkOutcome } from "../lib/bulkOps";
import { readDrop } from "../lib/dragDrop";
import {
  browsePath,
  decodeSplat,
  joinPath,
  parentPath,
  previewPath,
  sortEntries,
  type SortDir,
  type SortKey,
} from "../lib/listing";
import { useBrowseRoute } from "../lib/browseRoute";
import { publicAliasPath } from "../lib/publicUrl";
import { listVdirs, toApiFailure, type VdirRecord } from "../lib/records";
import { uploadQueue } from "../lib/uploadQueue";
import { extractJobs } from "../lib/extractJobs";
import { useSession } from "../lib/session";
import { useVdirRole } from "../lib/useVdirRole";
import { Breadcrumbs } from "../components/Breadcrumbs";
import { BulkResultNotice } from "../components/BulkResultNotice";
import { ContextMenu } from "../components/ContextMenu";
import {
  BulkDeleteAlert,
  DeleteAlert,
  ExtractSheet,
  MkdirSheet,
  RenameSheet,
} from "../components/FileOpsDialogs";
import { EmptyState, FailureState, Spinner, UnavailableState } from "../components/Errors";
import { EntryGrid, EntryList } from "../components/EntryViews";
import {
  CheckIcon,
  ChevronLeftIcon,
  FolderPlusIcon,
  GridIcon,
  ListIcon,
  SortIcon,
  UploadIcon,
} from "../components/icons";
import type { ApiFailure } from "../lib/filesApi";

type ViewMode = "list" | "grid";

type FileOp =
  | { kind: "mkdir" }
  | { kind: "rename" | "delete" | "extract"; entry: LsEntry; path: string };

type MenuState = { entry: LsEntry; path: string };

type BulkNotice = { action: "move" | "delete"; outcomes: BulkOutcome[] };

function loadView(): ViewMode {
  return localStorage.getItem("sf.view") === "grid" ? "grid" : "list";
}

export function BrowsePage() {
  const { vdirId, basePath, fileBase, publicMode, publicName } = useBrowseRoute();
  const location = useLocation();
  const { pathname } = location;
  const navigate = useNavigate();
  const path = useMemo(() => {
    const raw = pathname.startsWith(basePath) ? pathname.slice(basePath.length) : "";
    return decodeSplat(raw);
  }, [pathname, basePath]);

  const [view, setView] = useState<ViewMode>(loadView);
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const [entries, setEntries] = useState<LsEntry[]>([]);
  const [failure, setFailure] = useState<ApiFailure | null>(null);
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);

  const [vdir, setVdir] = useState<VdirRecord | null>(null);
  const [op, setOp] = useState<FileOp | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);

  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [bulkAlert, setBulkAlert] = useState(false);
  const [bulkRunning, setBulkRunning] = useState<{ processed: number; total: number } | null>(null);
  const [bulkNotice, setBulkNotice] = useState<BulkNotice | null>(null);
  const bulkLock = useRef(false);

  const { canWrite } = useVdirRole(vdir);
  // Public mode (design D3/D7): the long-lived public browse view takes
  // its name from the alias/meta gate, skips the authenticated record
  // API entirely, and can never write (vdir stays null → role none).
  const { state: sessionState } = useSession();
  const isPublicVdir = publicMode || vdir?.is_public === true;
  // Temporary links are for signed-in readers of a non-public vdir;
  // public vdirs keep the permanent Copy public link (design D11).
  const canMintLink = sessionState === "authenticated" && vdir !== null && !isPublicVdir;
  // Alias routes download through the alias; signed-in /v views keep
  // /files unless a registered name is being copied as the public link.
  const publicFileBase =
    publicMode && fileBase.startsWith("/apps/")
      ? fileBase
      : isPublicVdir && vdir?.public_slug
        ? publicAliasPath(vdir.public_slug)
        : undefined;
  const vdirName = publicMode ? (publicName ?? "") : (vdir?.name ?? "");

  const currentName = useMemo(() => {
    const segs = path.split("/").filter(Boolean);
    return segs.length > 0 ? segs[segs.length - 1] : vdirName;
  }, [path, vdirName]);

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
    if (!vdirId || publicMode) return;
    void listVdirs()
      .then((all) => {
        if (!cancelled) setVdir(all.find((v) => v.id === vdirId) ?? null);
      })
      .catch(() => {
        // The Locations list surfaces vdir-list failures; here the
        // record only drives the name and write-permission derivation.
      });
    return () => {
      cancelled = true;
    };
  }, [vdirId, publicMode]);

  const sorted = useMemo(() => sortEntries(entries, sortKey, sortDir), [entries, sortKey, sortDir]);
  const paths = useMemo(() => sorted.map((e) => joinPath(path, e.name)), [sorted, path]);

  const selectedItems = useMemo(
    () =>
      sorted.flatMap((entry, i) =>
        selected.has(paths[i]) ? [{ entry, path: paths[i] }] : [],
      ),
    [sorted, paths, selected],
  );
  const allSelected = paths.length > 0 && paths.every((p) => selected.has(p));

  // Selection belongs to the directory being browsed (design D2):
  // navigating away ends it, and a reload drops paths that no longer
  // exist while keeping the rest across sort/view changes.
  useEffect(() => {
    setSelectMode(false);
    setSelected(new Set());
    setBulkNotice(null);
  }, [path]);

  const pathSet = useMemo(() => new Set(paths), [paths]);
  useEffect(() => {
    if (!selectMode) return;
    setSelected((prev) => {
      const next = new Set([...prev].filter((p) => pathSet.has(p)));
      return next.size === prev.size ? prev : next;
    });
  }, [pathSet, selectMode]);

  // A bulk move returns to this directory with its per-item outcomes
  // (design D6). Show them once, then replace the history entry with a
  // state-free navigation so reload/back does not replay the notice.
  useEffect(() => {
    const state = location.state as { bulkResult?: BulkOutcome[]; bulkAction?: "move" | "delete" } | null;
    if (!state?.bulkResult) return;
    setBulkNotice({ action: state.bulkAction ?? "move", outcomes: state.bulkResult });
    setSelectMode(false);
    setSelected(new Set());
    void navigate(pathname, { replace: true, state: null });
  }, [location.state, navigate, pathname]);

  const startSelect = () => {
    setMenu(null);
    setSelectMode(true);
    setSelected(new Set());
  };

  const endSelect = () => {
    if (bulkRunning) return;
    setSelectMode(false);
    setSelected(new Set());
  };

  const toggleSelected = (entryPath: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(entryPath)) next.delete(entryPath);
      else next.add(entryPath);
      return next;
    });
  };

  const toggleAllSelected = () => {
    setSelected(allSelected ? new Set() : new Set(paths));
  };

  const switchView = (mode: ViewMode) => {
    setView(mode);
    localStorage.setItem("sf.view", mode);
  };

  const reload = () => setAttempt((n) => n + 1);
  const finishOp = () => {
    setOp(null);
    reload();
  };

  const startBulkDelete = () => {
    if (!vdirId || selectedItems.length === 0 || bulkRunning || bulkLock.current) return;
    setMenu(null);
    setBulkAlert(true);
  };

  // Confirming closes the alert before the batch starts (design D7), so
  // the selection bar stays visible with disabled controls and progress.
  const runBulkDelete = async () => {
    if (!vdirId || selectedItems.length === 0 || bulkLock.current) return;
    const items = selectedItems.map(({ entry, path }) => ({ name: entry.name, path }));
    bulkLock.current = true;
    setBulkAlert(false);
    setBulkNotice(null);
    setBulkRunning({ processed: 0, total: items.length });
    try {
      const outcomes = await bulkDelete(vdirId, items, {
        onProgress: (processed, total) => setBulkRunning({ processed, total }),
      });
      setBulkNotice({ action: "delete", outcomes });
      setSelectMode(false);
      setSelected(new Set());
      reload();
    } finally {
      bulkLock.current = false;
      setBulkRunning(null);
    }
  };

  const startBulkMove = () => {
    if (!vdirId || selectedItems.length === 0 || bulkRunning || bulkLock.current) return;
    setMenu(null);
    void navigate(`/v/${vdirId}/move`, {
      state: { entries: selectedItems, sourceDir: path },
    });
  };

  const uploadInput = useRef<HTMLInputElement>(null);
  const onUpload = (e: ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (vdirId && files && files.length > 0) {
      uploadQueue.enqueue(vdirId, path, Array.from(files));
    }
    e.target.value = "";
  };

  // Drag & drop (web-ui drag & drop spec, design D4): the listing is a
  // drop zone for writers. readDrop collects the entries synchronously
  // (the DataTransfer is invalidated once the handler returns) and
  // resolves to a plan of folders (parents first) and files.
  const dragDepth = useRef(0);
  const [dropActive, setDropActive] = useState(false);
  const [dropFailures, setDropFailures] = useState<string[]>([]);

  const handleDrop = (data: DataTransfer) => {
    if (!vdirId) return;
    void readDrop(data).then((plan) => {
      const entries = [
        ...plan.folders.map((folder) => ({ kind: "folder" as const, path: joinPath(path, folder) })),
        ...plan.files.map(({ path: relPath, file }) => ({
          kind: "upload" as const,
          path: joinPath(path, relPath),
          file,
        })),
      ];
      if (entries.length > 0) uploadQueue.enqueueEntries(vdirId, entries);
      setDropFailures((prev) => (prev.length === 0 && plan.failures.length === 0 ? prev : plan.failures));
    });
  };

  // Non-writers mount no handlers at all, so viewers and public
  // visitors keep the browser's default drop behavior and see no
  // drop affordance.
  const dropHandlers = canWrite
    ? {
        onDragEnter: (e: DragEvent<HTMLDivElement>) => {
          e.preventDefault();
          dragDepth.current += 1;
          setDropActive(true);
        },
        onDragOver: (e: DragEvent<HTMLDivElement>) => {
          // The browser only fires drop when dragover is canceled.
          e.preventDefault();
          if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
        },
        onDragLeave: () => {
          dragDepth.current = Math.max(0, dragDepth.current - 1);
          if (dragDepth.current === 0) setDropActive(false);
        },
        onDrop: (e: DragEvent<HTMLDivElement>) => {
          e.preventDefault();
          dragDepth.current = 0;
          setDropActive(false);
          handleDrop(e.dataTransfer);
        },
      }
    : {};

  // An upload that finishes while its target directory is open refreshes
  // the listing, so dropped or picked files appear without a reload.
  useEffect(() => {
    return uploadQueue.onSettled((item) => {
      if (item.state === "completed" && item.dir === path) reload();
    });
  }, [path]);

  // An extraction that finishes while its archive's directory is open
  // refreshes the listing, so the new folder appears without a reload.
  useEffect(() => {
    return extractJobs.onSettled((job) => {
      if (job.state !== "succeeded") return;
      if (parentPath(job.target) === path) reload();
    });
  }, [path]);

  const openDir = (next: string) => void navigate(browsePath(basePath, next));
  const openPreview = (_entry: LsEntry, entryPath: string) =>
    void navigate(previewPath(basePath, entryPath));
  const startMove = (entry: LsEntry, entryPath: string) => {
    setMenu(null);
    void navigate(`/v/${vdirId}/move`, {
      state: { entries: [{ entry, path: entryPath }], sourceDir: path },
    });
  };

  // Mint then copy, returning whether the clipboard now holds the
  // absolute link; failures stay in the menu and claim nothing.
  const copyTemporaryLink = async (entryPath: string): Promise<boolean> => {
    if (!vdirId) return false;
    try {
      const { url } = await mintFileLink(vdirId, entryPath);
      await navigator.clipboard.writeText(`${window.location.origin}${url}`);
      return true;
    } catch {
      return false;
    }
  };

  const goBack = () => {
    if (!path) void navigate("/files");
    else void navigate(browsePath(basePath, parentPath(path)));
  };

  // renderFailure maps the deterministic error classes into the
  // public-mode not-available state (web-ui spec): once the vdir stops
  // being public (401) or the path is gone (404), the anonymous
  // visitor sees an explicit not-available state with the sign-in
  // affordance instead of an unexplained error.
  const renderFailure = (failure: ApiFailure) =>
    publicMode && (failure.kind === "notfound" || failure.kind === "unauthorized") ? (
      <UnavailableState onSignIn={() => void navigate("/")} />
    ) : (
      <FailureState failure={failure} onRetry={reload} />
    );

  return (
    <div className="flex h-full flex-col">
      <div className="px-4 pt-1 pb-2">
        <div className="flex items-center justify-between">
          {(!publicMode || path) && (
            <button
              type="button"
              data-testid="back"
              onClick={goBack}
              className="flex items-center text-base text-ios-blue"
            >
              <ChevronLeftIcon className="mr-0.5 text-sm" />
              {path ? "Back" : "Files"}
            </button>
          )}
          <span className="text-xs text-ios-secondary/50">SSH connected</span>
        </div>
        <h1 className="mt-0.5 text-[30px] font-bold leading-tight tracking-tight text-ios-label">
          {currentName}
        </h1>
        {/* Write actions live in the folder header (design D3) so the
            compact toolbar below stays view-controls-only and fits at
            mobile widths. Selection mode replaces them with its bar. */}
        {canWrite && !selectMode && (
          <div className="mt-2 flex items-center gap-2" data-testid="header-actions">
            <button
              type="button"
              data-testid="new-folder"
              onClick={() => setOp({ kind: "mkdir" })}
              className="flex items-center gap-1 rounded-full border border-ios-separator bg-ios-card px-2.5 py-1.5 font-medium text-ios-label shadow-sm"
            >
              <FolderPlusIcon className="text-ios-blue" /> New
            </button>
            <button
              type="button"
              data-testid="upload-button"
              onClick={() => uploadInput.current?.click()}
              className="flex items-center gap-1 rounded-full bg-ios-blue px-3 py-1.5 font-medium text-white shadow-sm"
            >
              <UploadIcon /> Upload
            </button>
            <button
              type="button"
              data-testid="select-button"
              onClick={startSelect}
              className="flex items-center gap-1 rounded-full border border-ios-separator bg-ios-card px-2.5 py-1.5 font-medium text-ios-label shadow-sm"
            >
              <CheckIcon className="text-ios-blue" /> Select
            </button>
            <input
              ref={uploadInput}
              type="file"
              multiple
              data-testid="upload-input"
              onChange={onUpload}
              className="hidden"
            />
          </div>
        )}
        {canWrite && selectMode && (
          <div className="mt-2 flex flex-col gap-2" data-testid="selection-bar">
            <div className="flex items-center justify-between gap-2">
              <span
                data-testid="selection-count"
                aria-live="polite"
                className="text-sm font-semibold text-ios-label"
              >
                {bulkRunning
                  ? `Deleting ${bulkRunning.processed} of ${bulkRunning.total}…`
                  : `${selectedItems.length} selected`}
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  data-testid="select-all-toggle"
                  disabled={bulkRunning !== null || paths.length === 0}
                  onClick={toggleAllSelected}
                  className="rounded-full border border-ios-separator bg-ios-card px-2.5 py-1.5 font-medium text-ios-label shadow-sm disabled:opacity-40"
                >
                  {allSelected ? "Deselect all" : "Select all"}
                </button>
                <button
                  type="button"
                  data-testid="selection-done"
                  disabled={bulkRunning !== null}
                  onClick={endSelect}
                  className="rounded-full bg-ios-blue px-3 py-1.5 font-medium text-white shadow-sm disabled:opacity-40"
                >
                  Done
                </button>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                data-testid="bulk-move"
                disabled={selectedItems.length === 0 || bulkRunning !== null}
                onClick={startBulkMove}
                className="flex-1 rounded-full border border-ios-separator bg-ios-card px-3 py-1.5 font-medium text-ios-label shadow-sm disabled:opacity-40"
              >
                Move
              </button>
              <button
                type="button"
                data-testid="bulk-delete"
                disabled={selectedItems.length === 0 || bulkRunning !== null}
                onClick={startBulkDelete}
                className="flex-1 rounded-full bg-ios-red px-3 py-1.5 font-medium text-white shadow-sm disabled:opacity-40"
              >
                Delete
              </button>
            </div>
          </div>
        )}
        <Breadcrumbs basePath={basePath} vdirName={vdirName} path={path} />
        {dropFailures.length > 0 && (
          <div
            role="alert"
            data-testid="drop-notice"
            className="mt-2 flex items-start justify-between gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800"
          >
            <span>Couldn't read {dropFailures.join(", ")}. The other items still upload.</span>
            <button
              type="button"
              data-testid="drop-notice-dismiss"
              onClick={() => setDropFailures([])}
              className="shrink-0 font-semibold text-ios-blue"
            >
              Dismiss
            </button>
          </div>
        )}
      </div>

      {bulkNotice && (
        <BulkResultNotice
          action={bulkNotice.action}
          outcomes={bulkNotice.outcomes}
          onDismiss={() => setBulkNotice(null)}
        />
      )}

      <div
        className="flex items-center gap-2 border-y border-ios-separator bg-ios-bg px-4 py-2 text-xs"
        data-testid="toolbar"
      >
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1.5 rounded-lg border border-ios-separator bg-ios-card px-2.5 py-1.5 font-medium text-ios-label shadow-sm">
            <SortIcon className="text-ios-blue" />
            <select
              id="sort-key"
              data-testid="sort-key"
              aria-label="Sort by"
              value={sortKey}
              onChange={(e) => setSortKey(e.target.value as SortKey)}
              className="bg-transparent outline-none"
            >
              <option value="name">Name</option>
              <option value="size">Size</option>
              <option value="modified">Modified</option>
            </select>
          </span>
          <button
            type="button"
            data-testid="sort-direction"
            onClick={() => setSortDir((d) => (d === "asc" ? "desc" : "asc"))}
            aria-label={sortDir === "asc" ? "Sorted ascending; switch to descending" : "Sorted descending; switch to ascending"}
            className="rounded-lg border border-ios-separator bg-ios-card px-2.5 py-1.5 font-medium text-ios-label shadow-sm"
          >
            {sortDir === "asc" ? "A→Z" : "Z→A"}
          </button>
          <span className="flex rounded-lg bg-ios-separator p-0.5">
            <button
              type="button"
              data-testid="view-list"
              aria-pressed={view === "list"}
              onClick={() => switchView("list")}
              aria-label="List view"
              className={`rounded-md px-2 py-1 ${view === "list" ? "bg-ios-card text-ios-label shadow-sm" : "text-ios-secondary/70"}`}
            >
              <ListIcon />
            </button>
            <button
              type="button"
              data-testid="view-grid"
              aria-pressed={view === "grid"}
              onClick={() => switchView("grid")}
              aria-label="Grid view"
              className={`rounded-md px-2 py-1 ${view === "grid" ? "bg-ios-card text-ios-label shadow-sm" : "text-ios-secondary/70"}`}
            >
              <GridIcon />
            </button>
          </span>
        </div>
      </div>

      <div
        data-testid="drop-zone"
        data-drop-active={dropActive ? "true" : undefined}
        className={`min-h-0 flex-1 ${dropActive ? "bg-ios-blue/5 ring-2 ring-inset ring-ios-blue/60" : ""}`}
        {...dropHandlers}
      >
        {loading ? (
          <Spinner label="Loading directory…" />
        ) : failure ? (
          renderFailure(failure)
        ) : sorted.length === 0 ? (
          <EmptyState
            title="This directory is empty"
            hint={canWrite ? "Drop files or folders here to upload them." : undefined}
          />
        ) : view === "list" ? (
          <EntryList
            entries={sorted}
            paths={paths}
            onOpenDir={openDir}
            onPreview={openPreview}
            onMenu={(entry, entryPath) => setMenu({ entry, path: entryPath })}
            selectionMode={selectMode}
            selected={selected}
            onToggle={toggleSelected}
          />
        ) : (
          <EntryGrid
            entries={sorted}
            paths={paths}
            onOpenDir={openDir}
            onPreview={openPreview}
            onMenu={(entry, entryPath) => setMenu({ entry, path: entryPath })}
            selectionMode={selectMode}
            selected={selected}
            onToggle={toggleSelected}
          />
        )}
      </div>

      {menu && (
        <ContextMenu
          vdirId={vdirId ?? ""}
          fileBase={fileBase}
          publicFileBase={publicFileBase}
          entry={menu.entry}
          path={menu.path}
          canWrite={canWrite}
          isPublic={isPublicVdir}
          canMintLink={canMintLink}
          onCopyTemporaryLink={copyTemporaryLink}
          onOpenDir={(p) => {
            setMenu(null);
            openDir(p);
          }}
          onPreview={(entry, p) => {
            setMenu(null);
            openPreview(entry, p);
          }}
          onRename={(entry, p) => {
            setMenu(null);
            setOp({ kind: "rename", entry, path: p });
          }}
          onMove={startMove}
          onDelete={(entry, p) => {
            setMenu(null);
            setOp({ kind: "delete", entry, path: p });
          }}
          onExtract={(entry, p) => {
            setMenu(null);
            setOp({ kind: "extract", entry, path: p });
          }}
          onClose={() => setMenu(null)}
        />
      )}

      {op?.kind === "mkdir" && (
        <MkdirSheet vdirId={vdirId ?? ""} dir={path} onClose={() => setOp(null)} onDone={finishOp} />
      )}
      {op?.kind === "rename" && (
        <RenameSheet
          vdirId={vdirId ?? ""}
          entry={op.entry}
          path={op.path}
          onClose={() => setOp(null)}
          onDone={finishOp}
        />
      )}
      {op?.kind === "extract" && (
        <ExtractSheet
          vdirId={vdirId ?? ""}
          entry={op.entry}
          path={op.path}
          onClose={() => setOp(null)}
          onStarted={() => setOp(null)}
        />
      )}
      {op?.kind === "delete" && (
        <DeleteAlert
          vdirId={vdirId ?? ""}
          entry={op.entry}
          path={op.path}
          onClose={() => setOp(null)}
          onDone={finishOp}
        />
      )}
      {bulkAlert && (
        <BulkDeleteAlert
          count={selectedItems.length}
          hasFolders={selectedItems.some((item) => item.entry.dir)}
          onClose={() => setBulkAlert(false)}
          onConfirm={() => void runBulkDelete()}
        />
      )}
    </div>
  );
}
