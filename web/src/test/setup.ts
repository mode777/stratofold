import "@testing-library/jest-dom/vitest";
import "@testing-library/react";

// jsdom has no layout: give every element a fixed viewport-sized rect
// so TanStack Virtual materializes a window, and provide a no-op
// ResizeObserver.
if (!globalThis.ResizeObserver) {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  globalThis.ResizeObserver = ResizeObserverStub as never;
}

if (!Element.prototype.scrollTo) {
  Element.prototype.scrollTo = (() => {}) as never;
}

Element.prototype.getBoundingClientRect = function (): DOMRect {
  return {
    width: 800,
    height: 600,
    top: 0,
    left: 0,
    right: 800,
    bottom: 600,
    x: 0,
    y: 0,
    toJSON() {
      return {};
    },
  } as DOMRect;
};

// TanStack Virtual measures its scroll element via offsetWidth/Height
// (jsdom reports 0), so give elements a viewport-sized box.
Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
  configurable: true,
  get() {
    return 800;
  },
});
Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
  configurable: true,
  get() {
    return 600;
  },
});


