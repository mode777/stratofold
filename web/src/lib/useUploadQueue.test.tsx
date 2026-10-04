import { act, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { UploadQueue } from "./uploadQueue";
import { useUploadQueue } from "./useUploadQueue";

function Probe({ queue }: { queue: UploadQueue }) {
  const snapshot = useUploadQueue(queue);
  return (
    <div data-testid="probe">
      {snapshot.paused ? "paused" : "running"} · {snapshot.items.length}
    </div>
  );
}

function makeQueue(): UploadQueue {
  return new UploadQueue(async () => ({ path: "", size: 0 }));
}

describe("useUploadQueue", () => {
  it("re-renders subscribers when the queue changes", () => {
    const queue = makeQueue();
    render(<Probe queue={queue} />);
    expect(screen.getByTestId("probe")).toHaveTextContent("running · 0");

    act(() => queue.pause());
    expect(screen.getByTestId("probe")).toHaveTextContent("paused · 0");
  });

  it("unsubscribes on unmount", () => {
    const queue = makeQueue();
    const listeners = (queue as unknown as { listeners: Set<unknown> }).listeners;
    const { unmount } = render(<Probe queue={queue} />);
    expect(listeners.size).toBe(1);

    unmount();
    expect(listeners.size).toBe(0);
  });
});
