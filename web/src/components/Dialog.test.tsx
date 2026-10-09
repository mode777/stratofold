import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Alert, Sheet } from "./Dialog";

function SheetHost({ onClose = vi.fn() }: { onClose?: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open sheet
      </button>
      {open && (
        <Sheet
          label="New folder"
          onClose={() => {
            onClose();
            setOpen(false);
          }}
        >
          <button type="button">Create</button>
        </Sheet>
      )}
    </>
  );
}

describe("Sheet", () => {
  it("opens, closes on the close control, and returns focus to the opener", async () => {
    const user = userEvent.setup();
    render(<SheetHost />);
    const opener = screen.getByRole("button", { name: "Open sheet" });

    await user.click(opener);
    expect(screen.getByTestId("sheet")).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "New folder" })).toBeInTheDocument();

    await user.click(screen.getByTestId("sheet-backdrop"));
    expect(screen.queryByTestId("sheet")).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });

  it("closes on Escape", async () => {
    const user = userEvent.setup();
    render(<SheetHost />);
    await user.click(screen.getByRole("button", { name: "Open sheet" }));
    await user.keyboard("{Escape}");
    expect(screen.queryByTestId("sheet")).not.toBeInTheDocument();
  });
});

describe("Alert", () => {
  it("confirms and cancels", async () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <Alert
        title="Delete thing?"
        message="This cannot be undone."
        confirmLabel="Delete"
        destructive
        onCancel={onCancel}
        onConfirm={onConfirm}
        confirmTestid="delete-confirm"
      />,
    );
    await userEvent.setup().click(screen.getByTestId("delete-confirm"));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    await userEvent.setup().click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("closes on Escape", async () => {
    const onCancel = vi.fn();
    render(
      <Alert
        title="Delete thing?"
        confirmLabel="Delete"
        onCancel={onCancel}
        onConfirm={vi.fn()}
      />,
    );
    await userEvent.setup().keyboard("{Escape}");
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
