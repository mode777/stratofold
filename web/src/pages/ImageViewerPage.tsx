// In-app fullscreen image gallery (web-ui spec,
// add-fullscreen-image-gallery): a fixed, dark, edge-to-edge overlay
// replacing the former card-style viewer. The strip shows the current
// slide with one materialized neighbor on each side (design D3) and
// is paged by swipe at fit-to-screen zoom (D4); pinch/pan/double-tap
// come from the pure gesture module (D1/D6). Chrome — back, name,
// size/modified, gallery position, download — floats above and
// toggles on image tap (D5). Slides keep per-image state machines, so
// a fetch failure (retryable) or an undecodable image (metadata card)
// never breaks the gallery. Bytes stream from the plain /files URL
// through fetch → blob → object URL (D5 of add-audio-player-image-
// viewer) so request failures stay distinguishable from decode
// failures.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { ApiFailure, filesUrl, sfFetch, type LsEntry } from "../lib/filesApi";
import { entryKind } from "../lib/entryKind";
import * as gesture from "../lib/gesture";
import { browseUrl, joinPath, parentPath, previewUrl } from "../lib/listing";
import { toApiFailure } from "../lib/records";
import { FailureState, Spinner } from "../components/Errors";
import { MetadataCard } from "../components/MetadataCard";
import { ChevronLeftIcon, DownloadIcon } from "../components/icons";
import { formatModTime, formatSize } from "../lib/listing";

type SlideState =
  | { status: "loading" }
  | { status: "ready"; url: string }
  | { status: "failed"; failure: ApiFailure }
  | { status: "undecodable" };

// The settle animation duration; the page turn commits at its end.
const SETTLE_MS = 190;

export function ImageViewerPage({
  vdirId,
  path,
  entry,
  listing,
}: {
  vdirId: string;
  path: string;
  entry: LsEntry;
  listing: LsEntry[];
}) {
  const navigate = useNavigate();
  const dir = parentPath(path);
  const name = path.split("/").filter(Boolean).pop() ?? "";

  // The gallery is built once from the listing that contained the
  // opened entry (design D2): listing order, image-kind entries only.
  const gallery = useMemo(
    () => listing.filter((e) => !e.dir && entryKind(e.name) === "image"),
    [listing],
  );
  const propIndex = gallery.findIndex((e) => e.name === name);

  const [current, setCurrent] = useState(propIndex < 0 ? 0 : propIndex);
  const [lastPath, setLastPath] = useState(path);
  const [chromeVisible, setChromeVisible] = useState(true);
  const [transform, setTransform] = useState<gesture.Transform>(gesture.IDENTITY);
  const [natural, setNatural] = useState<gesture.Size>({ w: 0, h: 0 });
  const [dragX, setDragX] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [settling, setSettling] = useState(false);
  const [slides, setSlides] = useState<Record<string, SlideState>>({});
  const [nonce, setNonce] = useState(0);

  // Sync the displayed position when the route changes underneath
  // (swipe replace-navigation, deep links, browser back) — the
  // React-sanctioned adjust-state-during-render pattern — and reset
  // the zoom with the image (spec: fit-to-screen on image change).
  if (path !== lastPath) {
    setLastPath(path);
    setCurrent(propIndex < 0 ? 0 : propIndex);
    setTransform(gesture.IDENTITY);
    setNatural({ w: 0, h: 0 });
    setDragX(0);
    setDragging(false);
    setSettling(false);
  }

  const currentEntry = gallery[current] ?? entry;
  const currentName = currentEntry.name;
  const currentPath = joinPath(dir, currentName);

  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const fitted = gesture.fitSize(natural, { w: vw, h: vh });

  const goBack = useCallback(
    () => void navigate(browseUrl(vdirId, dir)),
    [navigate, vdirId, dir],
  );

  const advance = useCallback(
    (step: number) => {
      const next = current + step;
      if (next < 0 || next >= gallery.length) return;
      setCurrent(next);
      setTransform(gesture.IDENTITY);
      setNatural({ w: 0, h: 0 });
      void navigate(previewUrl(vdirId, joinPath(dir, gallery[next].name)), { replace: true });
    },
    [current, gallery, dir, vdirId, navigate],
  );

  // Pointer bookkeeping lives in refs; rendering state (dragX,
  // transform) is updated through the handlers below.
  const stageRef = useRef<HTMLDivElement>(null);
  const pointers = useRef(new Map<number, gesture.Vec2>());
  const pinchBase = useRef<{ dist: number; mid: gesture.Vec2; t: gesture.Transform } | null>(null);
  const dragStart = useRef<{ pos: gesture.Vec2; last: gesture.Vec2 } | null>(null);
  const movedRef = useRef(false);
  const lastTap = useRef<{ time: number; pos: gesture.Vec2 } | null>(null);
  const pendingTap = useRef<number | null>(null);
  const settleTimer = useRef<number | null>(null);
  const settleToken = useRef(0);

  const capture = (e: React.PointerEvent) => {
    try {
      stageRef.current?.setPointerCapture?.(e.pointerId);
    } catch {
      // jsdom has no pointer capture; gestures still work via events.
    }
  };

  const onPointerDown = (e: React.PointerEvent) => {
    capture(e);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    settleToken.current += 1;
    if (pointers.current.size === 1) {
      movedRef.current = false;
      const pos = { x: e.clientX, y: e.clientY };
      dragStart.current = { pos, last: pos };
      if (settling) {
        setSettling(false);
        setDragX(0);
      }
    } else if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinchBase.current = {
        dist: Math.max(1, gesture.distance(a, b)),
        mid: gesture.midpoint(a, b),
        t: transform,
      };
      dragStart.current = null;
      setDragX(0);
      setDragging(false);
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const base = pinchBase.current;
    if (pointers.current.size >= 2 && base) {
      const [a, b] = [...pointers.current.values()];
      const dist = Math.max(1, gesture.distance(a, b));
      const focal = gesture.midpoint(a, b);
      setTransform(
        gesture.pinch(base.t, { scaleFactor: dist / base.dist, focal }, fitted, { w: vw, h: vh }),
      );
      movedRef.current = true;
      return;
    }
    const start = dragStart.current;
    if (!start) return;
    const dx = e.clientX - start.last.x;
    const dy = e.clientY - start.last.y;
    start.last = { x: e.clientX, y: e.clientY };
    if (
      Math.abs(e.clientX - start.pos.x) > gesture.TAP_SLOP ||
      Math.abs(e.clientY - start.pos.y) > gesture.TAP_SLOP
    ) {
      movedRef.current = true;
    }
    if (transform.scale > gesture.MIN_SCALE) {
      setTransform((t) => gesture.pan(t, { x: dx, y: dy }, fitted, { w: vw, h: vh }));
      return;
    }
    // Fit-to-screen drag: horizontal paging with rubber banding at
    // the ends (no wrap); while zoomed the branch above pans instead.
    const raw = e.clientX - start.pos.x;
    const capped = Math.max(-vw, Math.min(vw, raw));
    const resisted = gesture.rubberBand(capped, capped > 0 ? current > 0 : current < gallery.length - 1);
    setDragging(true);
    setDragX(resisted);
  };

  const onPointerUp = (e: React.PointerEvent) => {
    if (!pointers.current.delete(e.pointerId)) return;
    if (pointers.current.size > 0) {
      if (pointers.current.size === 1) {
        const [id] = [...pointers.current.keys()];
        const pos = pointers.current.get(id)!;
        pinchBase.current = null;
        dragStart.current = { pos, last: pos };
        movedRef.current = true;
      }
      return;
    }
    pinchBase.current = null;
    const start = dragStart.current;
    dragStart.current = null;
    if (!start) return;

    if (!movedRef.current) {
      // A still press is a tap: toggle chrome, unless it completes a
      // double-tap — the zoom step preempts the chrome toggle.
      const now = performance.now();
      const pos = { x: e.clientX, y: e.clientY };
      const previous = lastTap.current;
      if (
        previous &&
        now - previous.time < gesture.DOUBLE_TAP_MS &&
        gesture.distance(pos, previous.pos) < 40
      ) {
        lastTap.current = null;
        if (pendingTap.current !== null) {
          window.clearTimeout(pendingTap.current);
          pendingTap.current = null;
        }
        setTransform((t) => gesture.doubleTap(t, pos, fitted, { w: vw, h: vh }));
        return;
      }
      lastTap.current = { time: now, pos };
      pendingTap.current = window.setTimeout(() => {
        pendingTap.current = null;
        setChromeVisible((v) => !v);
      }, gesture.DOUBLE_TAP_MS);
      setDragX(0);
      setDragging(false);
      return;
    }

    if (transform.scale > gesture.MIN_SCALE || dragX === 0) {
      setDragging(false);
      setDragX(0);
      return;
    }
    const intent = gesture.swipeIntent(dragX, vw, {
      prev: current > 0,
      next: current < gallery.length - 1,
    });
    setDragging(false);
    if (intent === null) {
      setSettling(true);
      setDragX(0);
      return;
    }
    // Animate the strip to the neighbor, then commit the page turn
    // (replace-navigation keeps the URL on the displayed image, D4).
    setSettling(true);
    setDragX(intent * vw);
    const token = settleToken.current;
    settleTimer.current = window.setTimeout(() => {
      if (settleToken.current !== token || pointers.current.size > 0) {
        setSettling(false);
        setDragX(0);
        return;
      }
      setSettling(false);
      setDragX(0);
      advance(intent);
    }, SETTLE_MS);
  };

  const onPointerCancel = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    pinchBase.current = null;
    dragStart.current = null;
    setDragging(false);
    setSettling(false);
    setDragX(0);
  };

  // Keyboard: Escape is an additional back trigger (D5); the arrow
  // keys page like a swipe (spec) and reset the zoom with the image.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") goBack();
      else if (e.key === "ArrowLeft") advance(-1);
      else if (e.key === "ArrowRight") advance(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [advance, goBack]);

  // Windowed slide cache (design D3): materialize the current image
  // and one neighbor per side; revoke object URLs that leave the
  // window. Each slide keeps its own state machine, so a broken slide
  // never affects the gallery.
  const slidesRef = useRef(slides);
  slidesRef.current = slides;
  const inflight = useRef(new Set<string>());

  useEffect(() => {
    const windowPaths = new Set(
      [current - 1, current, current + 1]
        .filter((i) => i >= 0 && i < gallery.length)
        .map((i) => joinPath(dir, gallery[i].name)),
    );
    for (const p of windowPaths) {
      const st = slidesRef.current[p];
      if (st && st.status !== "failed") continue;
      if (inflight.current.has(p)) continue;
      inflight.current.add(p);
      setSlides((s) => (s[p] ? s : { ...s, [p]: { status: "loading" } }));
      sfFetch(filesUrl(vdirId, p))
        .then(async (resp) => {
          const blob = await resp.blob();
          const url = URL.createObjectURL(blob);
          setSlides((s) => ({ ...s, [p]: { status: "ready", url } }));
        })
        .catch((err: unknown) => {
          setSlides((s) => ({
            ...s,
            [p]: {
              status: "failed",
              failure: err instanceof ApiFailure ? err : toApiFailure(err),
            },
          }));
        })
        .finally(() => {
          inflight.current.delete(p);
        });
    }
    for (const [p, st] of Object.entries(slidesRef.current)) {
      if (st.status === "ready" && !windowPaths.has(p)) {
        URL.revokeObjectURL(st.url);
        setSlides((s) => {
          if (!(p in s)) return s;
          const { [p]: _drop, ...rest } = s;
          return rest;
        });
      }
    }
  }, [current, gallery, dir, vdirId, nonce]);

  // Unmount revokes whatever the window still holds.
  useEffect(
    () => () => {
      for (const st of Object.values(slidesRef.current)) {
        if (st.status === "ready") URL.revokeObjectURL(st.url);
      }
      if (pendingTap.current !== null) window.clearTimeout(pendingTap.current);
      if (settleTimer.current !== null) window.clearTimeout(settleTimer.current);
    },
    [],
  );

  const retrySlide = (p: string) => {
    setSlides((s) => {
      if (!(p in s)) return s;
      const { [p]: _drop, ...rest } = s;
      return rest;
    });
    setNonce((n) => n + 1);
  };

  const markUndecodable = (p: string, url: string) => {
    URL.revokeObjectURL(url);
    setSlides((s) => ({ ...s, [p]: { status: "undecodable" } }));
  };

  if (gallery.length === 0) {
    return (
      <div data-testid="image-viewer" className="fixed inset-0 z-40 overflow-y-auto bg-black">
        <MetadataCard vdirId={vdirId} path={path} entry={entry} />
      </div>
    );
  }

  const stripTransition = dragging ? "none" : settling ? `transform ${SETTLE_MS}ms ease-out` : "none";

  const slide = (rel: -1 | 0 | 1) => {
    const i = current + rel;
    if (i < 0 || i >= gallery.length) {
      return <div className="absolute top-0 h-full" style={{ left: rel * vw, width: vw }} />;
    }
    const g = gallery[i];
    const p = joinPath(dir, g.name);
    const st: SlideState = slides[p] ?? { status: "loading" };
    const isCurrent = rel === 0;
    return (
      <div
        className="absolute top-0 flex h-full items-center justify-center overflow-hidden"
        style={{ left: rel * vw, width: vw }}
      >
        {isCurrent && st.status === "failed" ? (
          <FailureState failure={st.failure} onRetry={() => retrySlide(p)} />
        ) : isCurrent && st.status === "undecodable" ? (
          <MetadataCard vdirId={vdirId} path={p} entry={g} />
        ) : st.status === "ready" ? (
          <img
            src={st.url}
            alt={g.name}
            draggable={false}
            data-testid={isCurrent ? "image-frame" : undefined}
            onLoad={
              isCurrent
                ? (e) =>
                    setNatural({
                      w: e.currentTarget.naturalWidth,
                      h: e.currentTarget.naturalHeight,
                    })
                : undefined
            }
            onError={isCurrent ? () => markUndecodable(p, st.url) : undefined}
            style={{
              transform: isCurrent
                ? `translate3d(${transform.x}px, ${transform.y}px, 0) scale(${transform.scale})`
                : undefined,
            }}
            className="max-h-full max-w-full object-contain"
          />
        ) : (
          <Spinner label="Loading image…" />
        )}
      </div>
    );
  };

  return (
    <div data-testid="image-viewer" className="fixed inset-0 z-40 bg-black text-white">
      <div
        ref={stageRef}
        data-testid="viewer-stage"
        className="absolute inset-0 touch-none overscroll-none select-none [-webkit-touch-callout:none]"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
      >
        <div
          className="absolute inset-0"
          style={{ transform: `translate3d(${dragX}px, 0, 0)`, transition: stripTransition }}
        >
          {([-1, 0, 1] as const).map((rel) => (
            <div key={rel}>{slide(rel)}</div>
          ))}
        </div>
      </div>

      {chromeVisible && (
        <div
          data-testid="viewer-chrome"
          className="absolute inset-x-0 top-0 z-10 flex items-start justify-between gap-3 bg-gradient-to-b from-black/70 to-transparent p-4 pt-3"
        >
          <button
            type="button"
            data-testid="viewer-back"
            aria-label="Back"
            onClick={goBack}
            className="flex shrink-0 items-center text-base text-white active:scale-95"
          >
            <ChevronLeftIcon className="mr-0.5 text-sm" />
            Back
          </button>
          <div className="min-w-0 flex-1 text-center">
            <p data-testid="viewer-name" className="truncate text-sm font-semibold">
              {currentName}
            </p>
            <p className="text-xs text-white/60">
              {formatSize(currentEntry.size)} · Modified {formatModTime(currentEntry.modtime)}
            </p>
            <p data-testid="gallery-position" className="mt-0.5 text-xs text-white/60">
              {current + 1} / {gallery.length}
            </p>
          </div>
          <a
            href={filesUrl(vdirId, currentPath)}
            download
            data-testid="preview-download"
            aria-label="Download"
            className="flex shrink-0 items-center gap-1.5 rounded-xl border border-white/25 px-3 py-1.5 text-sm font-semibold active:scale-95"
          >
            <DownloadIcon />
          </a>
        </div>
      )}
    </div>
  );
}
