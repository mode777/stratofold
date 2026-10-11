// Pure gesture math for the fullscreen image gallery
// (add-fullscreen-image-gallery design D1/D6): pointer state and a
// current transform map to the next transform, with no DOM and no
// React, so unit tests can exercise the geometry directly and the
// viewer only wires events. Coordinates are viewport-relative; the
// image is flex-centered, so its transform origin is the viewport
// center and every formula is written in center-origin space.

export type Vec2 = { x: number; y: number };
export type Size = { w: number; h: number };
export type Transform = { scale: number; x: number; y: number };

export const MIN_SCALE = 1;
export const MAX_SCALE = 4;
export const DOUBLE_TAP_SCALE = 2.5;

// A drag counts as a tap below this pixel movement (and within
// TAP_MS); a second tap within DOUBLE_TAP_MS is a zoom step.
export const TAP_SLOP = 10;
export const TAP_MS = 400;
export const DOUBLE_TAP_MS = 300;

// A swipe pages once |offsetX| passes this fraction of the viewport
// width (never below SWIPE_MIN_PX); offsets past a missing neighbor
// are resisted by RUBBER (iOS-style rubber band).
export const SWIPE_FRACTION = 0.25;
export const SWIPE_MIN_PX = 40;
export const RUBBER = 0.3;

export const IDENTITY: Transform = { scale: MIN_SCALE, x: 0, y: 0 };

export function clamp(value: number, lo: number, hi: number): number {
  const v = Math.min(hi, Math.max(lo, value));
  return v === 0 ? 0 : v;
}

export function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function midpoint(a: Vec2, b: Vec2): Vec2 {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

// fitSize contains-fits a natural image size into a viewport, never
// upscaling (the viewer renders with max-width/max-height, which also
// never upscales — the math must match what is on screen); a natural
// size of zero (image not decoded yet, jsdom) falls back to the
// viewport itself so the math stays defined.
export function fitSize(natural: Size, viewport: Size): Size {
  if (natural.w <= 0 || natural.h <= 0) return { w: viewport.w, h: viewport.h };
  const ratio = Math.min(1, viewport.w / natural.w, viewport.h / natural.h);
  return { w: natural.w * ratio, h: natural.h * ratio };
}

// panClamp keeps the scaled image over the viewport: the image is
// centered, so translation is bounded by half the overflow per axis
// (none at fit-to-screen).
export function panClamp(t: Transform, fitted: Size, viewport: Size): Transform {
  const ox = Math.max(0, (fitted.w * t.scale - viewport.w) / 2);
  const oy = Math.max(0, (fitted.h * t.scale - viewport.h) / 2);
  return { scale: t.scale, x: clamp(t.x, -ox, ox), y: clamp(t.y, -oy, oy) };
}

// pinch scales about a focal point (the finger midpoint): the content
// point under the focal stays under it.
export function pinch(
  t: Transform,
  opts: { scaleFactor: number; focal: Vec2 },
  fitted: Size,
  viewport: Size,
): Transform {
  const scale = clamp(t.scale * opts.scaleFactor, MIN_SCALE, MAX_SCALE);
  const r = scale / t.scale;
  const cx = viewport.w / 2;
  const cy = viewport.h / 2;
  return panClamp(
    {
      scale,
      x: (opts.focal.x - cx) * (1 - r) + r * t.x,
      y: (opts.focal.y - cy) * (1 - r) + r * t.y,
    },
    fitted,
    viewport,
  );
}

// pan translates by a delta (drag while zoomed), clamped to bounds.
export function pan(t: Transform, delta: Vec2, fitted: Size, viewport: Size): Transform {
  return panClamp({ ...t, x: t.x + delta.x, y: t.y + delta.y }, fitted, viewport);
}

// doubleTap zooms to the next zoom step centered on the tap point
// from fit-to-screen, and resets to fit-to-screen when already zoomed.
export function doubleTap(t: Transform, point: Vec2, fitted: Size, viewport: Size): Transform {
  if (t.scale > MIN_SCALE) return { ...IDENTITY };
  const s = DOUBLE_TAP_SCALE;
  const cx = viewport.w / 2;
  const cy = viewport.h / 2;
  return panClamp({ scale: s, x: (point.x - cx) * (1 - s), y: (point.y - cy) * (1 - s) }, fitted, viewport);
}

// swipeIntent maps a settled horizontal drag to a page turn: 1 next,
// -1 previous, null when below threshold or the neighbor is missing
// (the ends never wrap).
export function swipeIntent(
  offsetX: number,
  width: number,
  dirs: { prev: boolean; next: boolean },
): 1 | -1 | null {
  if (Math.abs(offsetX) < Math.max(width * SWIPE_FRACTION, SWIPE_MIN_PX)) return null;
  const intent = offsetX < 0 ? 1 : -1;
  if (intent === 1 && !dirs.next) return null;
  if (intent === -1 && !dirs.prev) return null;
  return intent;
}

// rubberBand resists a drag past a missing neighbor so the ends feel
// elastic instead of hard.
export function rubberBand(offsetX: number, allowed: boolean): number {
  return allowed ? offsetX : offsetX * RUBBER;
}

// isTap decides whether a completed pointer gesture was a tap.
export function isTap(start: Vec2, end: Vec2, ms: number): boolean {
  return ms <= TAP_MS && distance(start, end) <= TAP_SLOP;
}
