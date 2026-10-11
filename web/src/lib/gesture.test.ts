import { describe, expect, it } from "vitest";
import {
  DOUBLE_TAP_SCALE,
  IDENTITY,
  MAX_SCALE,
  doubleTap,
  distance,
  fitSize,
  isTap,
  midpoint,
  pan,
  panClamp,
  pinch,
  rubberBand,
  swipeIntent,
} from "./gesture";

const VIEWPORT = { w: 100, h: 100 };
const FITTED = { w: 100, h: 100 };

describe("fitSize", () => {
  it("contains the natural size in the viewport without upscaling", () => {
    expect(fitSize({ w: 200, h: 100 }, VIEWPORT)).toEqual({ w: 100, h: 50 });
    expect(fitSize({ w: 50, h: 50 }, VIEWPORT)).toEqual({ w: 50, h: 50 });
  });

  it("falls back to the viewport when the image is not decoded yet", () => {
    expect(fitSize({ w: 0, h: 0 }, VIEWPORT)).toEqual(VIEWPORT);
  });
});

describe("panClamp", () => {
  it("allows no translation at fit-to-screen", () => {
    expect(panClamp({ scale: 1, x: 30, y: -30 }, FITTED, VIEWPORT)).toEqual({ scale: 1, x: 0, y: 0 });
  });

  it("bounds translation by half the overflow at scale", () => {
    expect(panClamp({ scale: 2, x: 60, y: -80 }, FITTED, VIEWPORT)).toEqual({ scale: 2, x: 50, y: -50 });
  });

  it("pins a smaller-than-viewport image to the center", () => {
    expect(panClamp({ scale: 1, x: 100, y: -100 }, { w: 40, h: 40 }, VIEWPORT)).toEqual({
      scale: 1,
      x: 0,
      y: 0,
    });
  });
});

describe("pinch", () => {
  it("keeps the content point under the focal stationary", () => {
    const t = pinch(IDENTITY, { scaleFactor: 2, focal: { x: 60, y: 40 } }, FITTED, VIEWPORT);
    expect(t).toEqual({ scale: 2, x: -10, y: 10 });
    // content point under the focal at identity is the focal itself:
    // screen = c + s*(q - c) + t must return it after the zoom.
    const q = { x: 60, y: 40 };
    const screen = {
      x: 50 + t.scale * (q.x - 50) + t.x,
      y: 50 + t.scale * (q.y - 50) + t.y,
    };
    expect(screen).toEqual(q);
  });

  it("clamps the scale at MAX_SCALE", () => {
    expect(pinch({ scale: 3.5, x: 0, y: 0 }, { scaleFactor: 2, focal: { x: 50, y: 50 } }, FITTED, VIEWPORT).scale).toBe(
      MAX_SCALE,
    );
    expect(pinch(IDENTITY, { scaleFactor: 10, focal: { x: 50, y: 50 } }, FITTED, VIEWPORT).scale).toBe(MAX_SCALE);
  });

  it("does not zoom out below fit-to-screen", () => {
    const t = pinch({ scale: 1.2, x: 0, y: 0 }, { scaleFactor: 0.5, focal: { x: 50, y: 50 } }, FITTED, VIEWPORT);
    expect(t.scale).toBe(1);
    expect(t.x).toBe(0);
    expect(t.y).toBe(0);
  });
});

describe("pan", () => {
  it("translates by the delta and clamps to the scaled bounds", () => {
    expect(pan({ scale: 2, x: 0, y: 0 }, { x: 10, y: -5 }, FITTED, VIEWPORT)).toEqual({ scale: 2, x: 10, y: -5 });
    expect(pan({ scale: 2, x: 0, y: 0 }, { x: 100, y: 0 }, FITTED, VIEWPORT)).toEqual({ scale: 2, x: 50, y: 0 });
  });
});

describe("doubleTap", () => {
  it("zooms to the step centered on the tap point from fit-to-screen", () => {
    expect(doubleTap(IDENTITY, { x: 75, y: 25 }, FITTED, VIEWPORT)).toEqual({
      scale: DOUBLE_TAP_SCALE,
      x: -37.5,
      y: 37.5,
    });
  });

  it("clamps the zoom translation to the image bounds", () => {
    // a fitted image that fills the viewport at the step has no slack
    expect(doubleTap(IDENTITY, { x: 99, y: 99 }, { w: 40, h: 40 }, VIEWPORT)).toEqual({ scale: 2.5, x: 0, y: 0 });
  });

  it("resets to fit-to-screen when already zoomed", () => {
    expect(doubleTap({ scale: 2, x: 20, y: -20 }, { x: 50, y: 50 }, FITTED, VIEWPORT)).toEqual(IDENTITY);
  });
});

describe("swipeIntent", () => {
  it("maps a left drag to next and a right drag to previous past the threshold", () => {
    expect(swipeIntent(-150, 400, { prev: true, next: true })).toBe(1);
    expect(swipeIntent(150, 400, { prev: true, next: true })).toBe(-1);
  });

  it("ignores drags below the threshold", () => {
    expect(swipeIntent(-50, 400, { prev: true, next: true })).toBeNull();
    expect(swipeIntent(50, 400, { prev: true, next: true })).toBeNull();
  });

  it("refuses page turns into missing neighbors", () => {
    expect(swipeIntent(150, 400, { prev: false, next: true })).toBeNull();
    expect(swipeIntent(-150, 400, { prev: true, next: false })).toBeNull();
  });
});

describe("rubberBand", () => {
  it("passes allowed drags through and resists disallowed ones", () => {
    expect(rubberBand(100, true)).toBe(100);
    expect(rubberBand(100, false)).toBeCloseTo(30);
    expect(rubberBand(-100, false)).toBeCloseTo(-30);
  });
});

describe("isTap", () => {
  it("accepts short still presses and rejects movement or slow presses", () => {
    expect(isTap({ x: 0, y: 0 }, { x: 5, y: 5 }, 200)).toBe(true);
    expect(isTap({ x: 0, y: 0 }, { x: 20, y: 0 }, 200)).toBe(false);
    expect(isTap({ x: 0, y: 0 }, { x: 0, y: 0 }, 500)).toBe(false);
  });
});

describe("pointer geometry", () => {
  it("measures distance and midpoint", () => {
    expect(distance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
    expect(midpoint({ x: 0, y: 10 }, { x: 20, y: 30 })).toEqual({ x: 10, y: 20 });
  });
});
