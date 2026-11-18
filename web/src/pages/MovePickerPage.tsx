// Move picker (web-ui spec, design D6): a pushed folder-tree screen.
// The selected entries and their source directory arrive in navigation
// state. A single entry keeps the original inline error behavior; a
// multi-entry move runs the bounded bulk executor, disables Back/Move
// Here while it runs, and returns the per-item outcomes to the browse
// view through navigation state.

import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router";
import { ls, mv, type ApiFailure, type LsEntry } from "../lib/filesApi";
import { bulkMove, type BulkOutcome } from "../lib/bulkOps";
import { browseUrl, joinPath, normalizeVirtualPath } from "../lib/listing";
import { toApiFailure } from "../lib/records";
import { FailureState, Spinner } from "../components/Errors";
import { ChevronLeftIcon, ChevronRightIcon, FolderIcon } from "../components/icons";

type MoveEntry = { entry: LsEntry; path: string };
type MoveState = { entries: MoveEntry[]; sourceDir: string } | null;

function insideSelected(dest: string, dirs: string[]): boolean {
  return dirs.some((dir) => dest === dir || dest.startsWith(`${dir}/`));
}

export function MovePickerPage() {
  const { vdirId = "" } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const state = location.state as MoveState;
  const entries = state?.entries ?? [];
  const sourceDir = state?.sourceDir ?? "";
  const sourceDirNorm = normalizeVirtualPath(sourceDir) ?? sourceDir;

  const [dest, setDest] = useState("");
  const [entriesInDest, setEntriesInDest] = useState<LsEntry[]>([]);
  const [failure, setFailure] = useState<ApiFailure | null>(null);
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ processed: number; total: number } | null>(null);
  const [manual, setManual] = useState(false);
  const [manualPath, setManualPath] = useState("");
  const bulkLock = useRef(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void ls(vdirId, dest)
      .then((found) => {
        if (!cancelled) {
          setEntriesInDest(found.filter((e) => e.dir));
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
  }, [vdirId, dest, attempt]);

  if (!state || entries.length === 0) {
    return <FailureState failure={toApiFailure(new Error("Choose an item to move first."))} />;
  }

  const single = entries.length === 1;
  const effectiveDest = manual ? manualPath.trim() : dest;
  const normalizedDest = normalizeVirtualPath(effectiveDest);
  const selectedDirs = entries.filter((item) => item.entry.dir).map((item) => item.path);
  const destInvalid =
    normalizedDest === null ||
    normalizedDest === sourceDirNorm ||
    insideSelected(normalizedDest, selectedDirs);
  const canMove = !busy && effectiveDest.length > 0 && !destInvalid;
  const title = single ? `Move “${entries[0].entry.name}”` : `Move ${entries.length} items`;

  const goBack = () => {
    if (busy) return;
    void navigate(browseUrl(vdirId, sourceDir));
  };

  const moveHere = async () => {
    if (!canMove || normalizedDest === null) return;

    if (single) {
      setBusy(true);
      setFailure(null);
      try {
        await mv(vdirId, entries[0].path, joinPath(normalizedDest, entries[0].entry.name));
        await navigate(browseUrl(vdirId, sourceDir));
      } catch (err) {
        setFailure(toApiFailure(err));
      } finally {
        setBusy(false);
      }
      return;
    }

    if (bulkLock.current) return;
    bulkLock.current = true;
    setBusy(true);
    setFailure(null);
    setProgress({ processed: 0, total: entries.length });
    try {
      const outcomes: BulkOutcome[] = await bulkMove(
        vdirId,
        entries.map(({ entry, path }) => ({ name: entry.name, path })),
        normalizedDest,
        {
          onProgress: (processed, total) => setProgress({ processed, total }),
        },
      );
      const failed = outcomes.some((outcome) => outcome.failure);
      await navigate(
        browseUrl(vdirId, sourceDir),
        failed ? { state: { bulkResult: outcomes, bulkAction: "move" } } : undefined,
      );
    } finally {
      bulkLock.current = false;
      setBusy(false);
      setProgress(null);
    }
  };


  return (
    <div className="flex min-h-dvh flex-col pb-24 md:pb-0">
      <div className="border-b border-ios-separator bg-ios-card p-4">
        <div className="flex items-center justify-between">
          <button
            type="button"
            data-testid="move-cancel"
            disabled={busy}
            onClick={goBack}
            className="flex items-center text-base text-ios-blue disabled:opacity-40"
          >
            <ChevronLeftIcon className="mr-1 text-sm" /> Back
          </button>
          <h1 data-testid="move-title" className="truncate text-base font-bold text-ios-label">
            {title}
          </h1>
          <span className="w-12" />
        </div>
        <p className="mt-1 text-xs text-ios-secondary/60">
          Destination: {effectiveDest || "vdir root"}
        </p>
      </div>

      {manual ? (
        <div className="p-4">
          <label htmlFor="move-manual" className="text-xs font-semibold uppercase text-ios-secondary/60">
            Destination path
          </label>
          <input
            id="move-manual"
            data-testid="move-manual"
            value={manualPath}
            onChange={(e) => setManualPath(e.target.value)}
            placeholder="folder/subfolder"
            className="mt-1 w-full rounded-xl border border-ios-separator bg-ios-card px-3 py-2.5 font-mono text-sm outline-none"
          />
        </div>
      ) : loading ? (
        <Spinner />
      ) : failure ? (
        <FailureState failure={failure} onRetry={() => setAttempt((n) => n + 1)} />
      ) : (
        <div className="flex-1 overflow-auto p-4">
          <div className="mb-2 flex items-center gap-1 text-sm text-ios-secondary/70">
            <button type="button" onClick={() => setDest("")} className="text-ios-blue">
              Root
            </button>
            {dest
              .split("/")
              .filter(Boolean)
              .map((seg, i, all) => (
                <span key={seg} className="flex items-center gap-1">
                  <span className="text-ios-secondary/30">/</span>
                  {i === all.length - 1 ? (
                    <span className="font-semibold text-ios-label">{seg}</span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setDest(all.slice(0, i + 1).join("/"))}
                      className="text-ios-blue"
                    >
                      {seg}
                    </button>
                  )}
                </span>
              ))}
          </div>
          {entriesInDest.length === 0 ? (
            <p className="py-6 text-center text-sm text-ios-secondary/50">No subfolders here.</p>
          ) : (
            <div className="divide-y divide-ios-separator overflow-hidden rounded-2xl border border-black/5 bg-ios-card shadow-sm">
              {entriesInDest.map((e) => (
                <button
                  key={e.name}
                  type="button"
                  data-testid="move-folder"
                  onClick={() => setDest(joinPath(dest, e.name))}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left active:bg-ios-bg"
                >
                  <FolderIcon className="text-lg text-ios-blue" />
                  <span className="min-w-0 flex-1 truncate text-base font-semibold text-ios-label">
                    {e.name}
                  </span>
                  <ChevronRightIcon className="text-xs text-ios-secondary/30" />
                </button>
              ))}
            </div>
          )}
          <div className="mt-4 text-center">
            <button
              type="button"
              data-testid="move-manual-toggle"
              onClick={() => {
                setManual(true);
                setManualPath(dest);
              }}
              className="font-mono text-xs text-ios-blue hover:underline"
            >
              Choose path manually
            </button>
          </div>
        </div>
      )}

      <div className="border-t border-ios-separator bg-ios-card p-4 pb-safe">
        {progress && (
          <p data-testid="move-progress" className="mb-2 text-center text-xs text-ios-secondary/70">
            Moving {progress.processed} of {progress.total}…
          </p>
        )}
        <button
          type="button"
          data-testid="move-submit"
          disabled={!canMove}
          onClick={() => void moveHere()}
          className="w-full rounded-xl bg-ios-blue py-3.5 font-semibold text-white shadow-sm disabled:opacity-40"
        >
          Move Here
        </button>
      </div>
    </div>
  );
}
