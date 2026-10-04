import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FailureState } from "../components/Errors";
import { ApiFailure, type FailureKind } from "../lib/filesApi";
import { BrowsePage } from "./BrowsePage";
import { pb } from "../lib/pb";
import { collectionList, installFetchMock, installPbMock, jsonResponse } from "../test/mockApi";

vi.mock("../lib/session", () => ({
  useSession: () => ({
    state: "authenticated",
    userId: "u1",
    userEmail: "owner@stratofold.test",
    login: vi.fn(),
    logout: vi.fn(),
  }),
}));

const MINE = { id: "v1", owner: "u1", name: "Mine", root_path: "/srv", is_public: false, connection: "c1" };

afterEach(() => vi.restoreAllMocks());

describe("FailureState mapping", () => {
  it.each([
    ["notfound", "state-notfound"],
    ["forbidden", "state-forbidden"],
    ["retryable", "state-retryable"],
    ["server", "state-error"],
    ["rejected", "state-error"],
  ] as Array<[FailureKind, string]>)("renders %s as %s", (kind, testid) => {
    render(<FailureState failure={new ApiFailure(kind, 0, "detail")} />);
    expect(screen.getByTestId(testid)).toBeInTheDocument();
  });

  it("offers no repeating write attempt on forbidden", () => {
    render(<FailureState failure={new ApiFailure("forbidden", 403, "nope")} />);
    expect(within(screen.getByTestId("state-forbidden")).queryByRole("button")).not.toBeInTheDocument();
  });

  it("offers a working retry action on retryable", async () => {
    const onRetry = vi.fn();
    render(<FailureState failure={new ApiFailure("retryable", 503, "try later")} onRetry={onRetry} />);
    await userEvent.setup().click(screen.getByTestId("action-retry"));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});

describe("browse retry integration", () => {
  beforeEach(() => {
    localStorage.clear();
    pb.authStore.clear();
  });

  it("re-issues the listing when the retry action is used", async () => {
    installPbMock([collectionList("vdirs", [MINE])]);
    let attempts = 0;
    installFetchMock([
      (url, init) => {
        if (url === "/api/sf/vdirs/v1/ls" && init?.method === "POST") {
          attempts += 1;
          if (attempts === 1) return jsonResponse(503, { message: "Temporarily unavailable" });
          return jsonResponse(200, { path: "", entries: [{ name: "ok.txt", size: 1, dir: false, modtime: "2026-01-01T00:00:00Z" }] });
        }
        return undefined;
      },
    ]);

    render(
      <MemoryRouter initialEntries={["/v/v1"]}>
        <Routes>
          <Route path="/v/:vdirId/*" element={<BrowsePage />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByTestId("state-retryable")).toBeInTheDocument());
    await userEvent.setup().click(screen.getByTestId("action-retry"));
    await waitFor(() => expect(screen.getByTestId("entry-0")).toHaveTextContent("ok.txt"));
    expect(attempts).toBe(2);
  });
});
