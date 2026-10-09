// Move picker (web-ui spec, design D6): a pushed folder-tree screen.
// The source entry arrives in navigation state; the user picks a
// destination folder and confirms "Move Here". A manual path entry is
// offered as a fallback.

import { useEffect, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router";
import { ls, mv, type ApiFailure, type LsEntry } from "../lib/filesApi";
import { browseUrl, joinPath, parentPath } from "../lib/listing";
import { toApiFailure } from "../lib/records";
import { FailureState, Spinner } from "../components/Errors";
import { ChevronLeftIcon, ChevronRightIcon, FolderIcon } from "../components/icons";

type MoveState = { entry: LsEntry; path: string } | null;

export function MovePickerPage() {
  const { vdirId = "" } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const state = location.state as MoveState;

  const [dest, setDest] = useState("");
  const [entries, setEntries] = useState<LsEntry[]>([]);
  const [failure, setFailure] = useState<ApiFailure | null>(null);
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [manual, setManual] = useState(false);
  const [manualPath, setManualPath] = useState("");

  const sourcePath = state?.path ?? "";
  const sourceDir = parentPath(sourcePath);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void ls(vdirId, dest)
      .then((found) => {
        if (!cancelled) {
          setEntries(found.filter((e) => e.dir));
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

  if (!state) {
    return <FailureState failure={toApiFailure(new Error("Choose an item to move first."))} />;
  }

  const moveHere = async (targetDir: string) => {
    if (!state) return;
    setBusy(true);
    setFailure(null);
    try {
      await mv(vdirId, sourcePath, joinPath(targetDir, state.entry.name));
      await navigate(browseUrl(vdirId, sourceDir));
    } catch (err) {
      setFailure(toApiFailure(err));
    } finally {
      setBusy(false);
    }
  };

  const effectiveDest = manual ? manualPath.trim() : dest;

  return (
    <div className="flex min-h-dvh flex-col">
      <div className="border-b border-ios-separator bg-ios-card p-4">
        <div className="flex items-center justify-between">
          <button
            type="button"
            data-testid="move-cancel"
            onClick={() => void navigate(browseUrl(vdirId, sourceDir))}
            className="flex items-center text-base text-ios-blue"
          >
            <ChevronLeftIcon className="mr-1 text-sm" /> Back
          </button>
          <h1 className="truncate text-base font-bold text-ios-label">Move “{state.entry.name}”</h1>
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
          {entries.length === 0 ? (
            <p className="py-6 text-center text-sm text-ios-secondary/50">No subfolders here.</p>
          ) : (
            <div className="divide-y divide-ios-separator overflow-hidden rounded-2xl border border-black/5 bg-ios-card shadow-sm">
              {entries.map((e) => (
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
        <button
          type="button"
          data-testid="move-submit"
          disabled={busy || effectiveDest === sourceDir || !effectiveDest}
          onClick={() => void moveHere(effectiveDest)}
          className="w-full rounded-xl bg-ios-blue py-3.5 font-semibold text-white shadow-sm disabled:opacity-40"
        >
          Move Here
        </button>
      </div>
    </div>
  );
}
