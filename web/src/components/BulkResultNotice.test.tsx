import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ApiFailure, type FailureKind } from "../lib/filesApi";
import type { BulkOutcome } from "../lib/bulkOps";
import { BulkResultNotice, failureLabel } from "./BulkResultNotice";

function outcome(name: string, kind?: FailureKind): BulkOutcome {
  return {
    name,
    path: name,
    ...(kind ? { failure: new ApiFailure(kind, 0, name) } : {}),
  };
}

describe("BulkResultNotice", () => {
  it("renders nothing when every item succeeded", () => {
    const { container } = render(
      <BulkResultNotice action="delete" outcomes={[outcome("a.txt"), outcome("b.txt")]} onDismiss={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("reports the counts and names one failure", () => {
    render(
      <BulkResultNotice
        action="delete"
        outcomes={[outcome("a.txt"), outcome("b.txt", "notfound")]}
        onDismiss={vi.fn()}
      />,
    );

    expect(screen.getByTestId("bulk-result-summary")).toHaveTextContent(
      "Deleted 1 of 2 items. 1 failed.",
    );
    expect(screen.getByTestId("bulk-result-failure")).toHaveTextContent("b.txt (not found)");
  });

  it("uses the move verb and permission vocabulary", () => {
    render(
      <BulkResultNotice
        action="move"
        outcomes={[outcome("a.txt", "forbidden"), outcome("b.txt", "retryable")]}
        onDismiss={vi.fn()}
      />,
    );

    expect(screen.getByTestId("bulk-result-summary")).toHaveTextContent(
      "Moved 0 of 2 items. 2 failed.",
    );
    expect(screen.getAllByTestId("bulk-result-failure")[0]).toHaveTextContent(
      "a.txt (permission denied)",
    );
    expect(screen.getAllByTestId("bulk-result-failure")[1]).toHaveTextContent(
      "b.txt (temporarily unavailable)",
    );
  });

  it("bounds the named sample and reports the remainder", () => {
    const failures = Array.from({ length: 7 }, (_, i) => outcome(`f${i}.txt`, "server"));
    render(<BulkResultNotice action="delete" outcomes={failures} onDismiss={vi.fn()} />);

    expect(screen.getAllByTestId("bulk-result-failure")).toHaveLength(5);
    expect(screen.getByTestId("bulk-result")).toHaveTextContent("and 2 more");
  });

  it("dismisses without changing the result data", async () => {
    const onDismiss = vi.fn();
    render(
      <BulkResultNotice
        action="delete"
        outcomes={[outcome("a.txt"), outcome("b.txt", "rejected")]}
        onDismiss={onDismiss}
      />,
    );

    await userEvent.setup().click(screen.getByTestId("bulk-result-dismiss"));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("maps every failure class to the shared vocabulary", () => {
    expect(failureLabel(new ApiFailure("notfound", 404, ""))).toBe("not found");
    expect(failureLabel(new ApiFailure("forbidden", 403, ""))).toBe("permission denied");
    expect(failureLabel(new ApiFailure("retryable", 503, ""))).toBe("temporarily unavailable");
    expect(failureLabel(new ApiFailure("rejected", 400, ""))).toBe("rejected");
    expect(failureLabel(new ApiFailure("server", 500, ""))).toBe("server error");
    expect(failureLabel(new ApiFailure("unauthorized", 401, ""))).toBe("signed out");
  });
});
