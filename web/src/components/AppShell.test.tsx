import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { describe, expect, it } from "vitest";
import { AppShell, activeUploadCount } from "./AppShell";
import { FloatingUploadIndicator } from "./FloatingUploadIndicator";
import { UploadQueue, type UploadFn } from "../lib/uploadQueue";

function renderShell(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<AppShell />}>
          <Route path="/files" element={<div>files destination</div>} />
          <Route path="/uploads" element={<div>uploads destination</div>} />
          <Route path="/settings" element={<div>settings destination</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

const neverUpload: UploadFn = () => new Promise(() => {});

describe("AppShell", () => {
  it("marks the active destination in both the tab bar and the sidebar", () => {
    renderShell("/files");
    expect(screen.getByTestId("tab-files")).toHaveAttribute("aria-current", "page");
    expect(screen.getByTestId("side-files")).toHaveAttribute("aria-current", "page");
    expect(screen.getByTestId("tab-uploads")).not.toHaveAttribute("aria-current");
  });

  it("renders the tab bar for mobile and the sidebar for wide viewports", () => {
    renderShell("/files");
    expect(screen.getByTestId("tab-bar").className).toContain("md:hidden");
    const sidebar = screen.getByTestId("sidebar");
    expect(sidebar.className).toContain("hidden");
    expect(sidebar.className).toContain("md:flex");
  });

  it("counts only active uploads for the badge", () => {
    expect(
      activeUploadCount([
        { state: "running" },
        { state: "queued" },
        { state: "paused" },
        { state: "completed" },
        { state: "failed" },
        { state: "canceled" },
      ]),
    ).toBe(3);
  });
});

describe("FloatingUploadIndicator", () => {
  it("renders nothing when the queue is idle", () => {
    const queue = new UploadQueue(neverUpload);
    const { container } = render(
      <MemoryRouter>
        <FloatingUploadIndicator queue={queue} />
      </MemoryRouter>,
    );
    expect(container.querySelector('[data-testid="floating-upload-indicator"]')).toBeNull();
  });

  it("shows while an upload is active and opens the Uploads destination", async () => {
    const queue = new UploadQueue(neverUpload);
    render(
      <MemoryRouter initialEntries={["/files"]}>
        <Routes>
          <Route path="/files" element={<FloatingUploadIndicator queue={queue} />} />
          <Route path="/uploads" element={<div>uploads destination</div>} />
        </Routes>
      </MemoryRouter>,
    );

    act(() => queue.enqueue("v1", "", [new File(["x"], "a.txt")]));
    const pill = await screen.findByTestId("floating-upload-indicator");
    expect(pill).toHaveTextContent("1 Uploading");

    await userEvent.setup().click(pill);
    expect(await screen.findByText("uploads destination")).toBeInTheDocument();
  });
});
