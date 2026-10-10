// Browse view (web-ui spec, design D4/D9): one vdir's directory listing
// at the splat path — iOS nav bar with back control, folder title, and
// breadcrumb path plus the writer-only New / Upload actions (design D3
// of fix-web-ui-and-session-lifetime), a compact view toolbar (sort,
// list/grid), virtualized list/grid entries, a long-press context menu,
// and the file-operation overlays. The deterministic error classes
// render as distinct states with a retry action on 503.

import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { useLocation, useNavigate, useParams } from "react-router";
import { ls, type LsEntry } from "../lib/filesApi";
import {
  browseUrl,
  decodeSplat,
  joinPath,
  parentPath,
  previewUrl,
  sortEntries,
  type SortDir,
  type SortKey,
} from "../lib/listing";
import { listVdirs, toApiFailure, type VdirRecord } from "../lib/records";
import { uploadQueue } from "../lib/uploadQueue";
import { useVdirRole } from "../lib/useVdirRole";
import { Breadcrumbs } from "../components/Breadcrumbs";
import { ContextMenu } from "../components/ContextMenu";
import { DeleteAlert, MkdirSheet, RenameSheet } from "../components/FileOpsDialogs";
import { EmptyState, FailureState, Spinner, UnavailableState } from "../components/Errors";
import { usePublicBrowseName } from "../components/PublicGate";
import { EntryGrid, EntryList } from "../components/EntryViews";
import { ChevronLeftIcon, FolderPlusIcon, GridIcon, ListIcon, SortIcon, UploadIcon } from "../components/icons";
import type { ApiFailure } from "../lib/filesApi";

type ViewMode = "list" | "grid";

type FileOp =
  | { kind: "mkdir" }
  | { kind: "rename" | "delete"; entry: LsEntry; path: string };

type MenuState = { entry: LsEntry; path: string };

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
  const [menu, setMenu] = useState<MenuState | null>(null);
  const { canWrite } = useVdirRole(vdir);
  // Public mode (design D3): the anonymous browse view takes the
  // vdir's name from the meta probe, skips the authenticated record
  // API entirely, and can never write (vdir stays null → role none).
  const publicName = usePublicBrowseName();
  const publicMode = publicName !== null;
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

  const switchView = (mode: ViewMode) => {
    setView(mode);
    localStorage.setItem("sf.view", mode);
  };

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

  const openDir = (next: string) => void navigate(browseUrl(vdirId ?? "", next));
  const openPreview = (_entry: LsEntry, entryPath: string) =>
    void navigate(previewUrl(vdirId ?? "", entryPath));
  const startMove = (entry: LsEntry, entryPath: string) => {
    setMenu(null);
    void navigate(`/v/${vdirId}/move`, { state: { entry, path: entryPath } });
  };

  const goBack = () => {
    if (!path) void navigate("/files");
    else void navigate(browseUrl(vdirId ?? "", parentPath(path)));
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
            mobile widths. */}
        {canWrite && (
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
        <Breadcrumbs vdirId={vdirId ?? ""} vdirName={vdirName} path={path} />
      </div>

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

      <div className="min-h-0 flex-1">
        {loading ? (
          <Spinner label="Loading directory…" />
        ) : failure ? (
          renderFailure(failure)
        ) : sorted.length === 0 ? (
          <EmptyState title="This directory is empty" />
        ) : view === "list" ? (
          <EntryList
            vdirId={vdirId ?? ""}
            entries={sorted}
            paths={paths}
            onOpenDir={openDir}
            onPreview={openPreview}
            onMenu={(entry, entryPath) => setMenu({ entry, path: entryPath })}
          />
        ) : (
          <EntryGrid
            vdirId={vdirId ?? ""}
            entries={sorted}
            paths={paths}
            onOpenDir={openDir}
            onPreview={openPreview}
            onMenu={(entry, entryPath) => setMenu({ entry, path: entryPath })}
          />
        )}
      </div>

      {menu && (
        <ContextMenu
          vdirId={vdirId ?? ""}
          entry={menu.entry}
          path={menu.path}
          canWrite={canWrite}
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
      {op?.kind === "delete" && (
        <DeleteAlert
          vdirId={vdirId ?? ""}
          entry={op.entry}
          path={op.path}
          onClose={() => setOp(null)}
          onDone={finishOp}
        />
      )}
    </div>
  );
}
