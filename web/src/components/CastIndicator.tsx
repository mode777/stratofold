// Shell-level casting indicator (design D3): visible while a Cast
// session is connected, on every destination and in public mode, with
// the only in-app stop action. The session itself lives in CastProvider,
// so it survives route changes.

import { useCast } from "../lib/cast";
import { CastIcon } from "./icons";

export function CastIndicator() {
  const { status, deviceName, stop } = useCast();
  if (status !== "connected" && status !== "casting") return null;
  return (
    <div
      data-testid="cast-indicator"
      role="status"
      className="fixed bottom-20 left-1/2 z-40 flex -translate-x-1/2 items-center gap-3 rounded-full border border-black/10 bg-ios-card/95 px-4 py-2 text-sm font-medium text-ios-label shadow-xl backdrop-blur md:bottom-4"
    >
      <CastIcon className="text-ios-blue" />
      <span className="max-w-[12rem] truncate">Casting to {deviceName}</span>
      <button
        type="button"
        data-testid="cast-stop"
        onClick={stop}
        className="rounded-full bg-ios-blue px-3 py-1 text-xs font-semibold text-white"
      >
        Stop
      </button>
    </div>
  );
}
