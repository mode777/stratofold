import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useInstallPrompt } from "./useInstallPrompt";

function fireBeforeInstallPrompt(prompt = vi.fn(async () => {})) {
  const event = new Event("beforeinstallprompt", { cancelable: true });
  Object.assign(event, {
    prompt,
    platforms: ["web"],
    userChoice: Promise.resolve({ outcome: "accepted", platform: "web" }),
  });
  act(() => {
    window.dispatchEvent(event);
  });
  return { event, prompt };
}

describe("useInstallPrompt", () => {
  it("reports no install until the browser signals one", () => {
    const { result } = renderHook(() => useInstallPrompt());
    expect(result.current.canInstall).toBe(false);
  });

  it("captures beforeinstallprompt and suppresses its default", () => {
    const { result } = renderHook(() => useInstallPrompt());
    const { event } = fireBeforeInstallPrompt();
    expect(result.current.canInstall).toBe(true);
    expect(event.defaultPrevented).toBe(true);
  });

  it("triggers the native prompt and then hides the affordance", async () => {
    const { result } = renderHook(() => useInstallPrompt());
    const { prompt } = fireBeforeInstallPrompt();

    await act(async () => {
      await result.current.promptInstall();
    });

    expect(prompt).toHaveBeenCalledTimes(1);
    expect(result.current.canInstall).toBe(false);
  });

  it("clears the affordance once the app is installed", () => {
    const { result } = renderHook(() => useInstallPrompt());
    fireBeforeInstallPrompt();
    expect(result.current.canInstall).toBe(true);

    act(() => {
      window.dispatchEvent(new Event("appinstalled"));
    });
    expect(result.current.canInstall).toBe(false);
  });

  it("removes its listeners on unmount", () => {
    const remove = vi.spyOn(window, "removeEventListener");
    const { unmount } = renderHook(() => useInstallPrompt());
    unmount();
    expect(remove).toHaveBeenCalledWith("beforeinstallprompt", expect.any(Function));
    expect(remove).toHaveBeenCalledWith("appinstalled", expect.any(Function));
    remove.mockRestore();
  });

  it("does nothing when there is no captured prompt", async () => {
    const { result } = renderHook(() => useInstallPrompt());
    await act(async () => {
      await result.current.promptInstall();
    });
    expect(result.current.canInstall).toBe(false);
  });
});
