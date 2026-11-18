import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";
import type { LsEntry } from "../lib/filesApi";
import { EntryGrid, EntryList } from "./EntryViews";

const entries: LsEntry[] = [
  { name: "docs", size: 0, dir: true, modtime: "2026-01-02T03:04:05Z" },
  { name: "a.txt", size: 10, dir: false, modtime: "2026-01-02T03:04:05Z" },
  { name: "b.txt", size: 2048, dir: false, modtime: "2026-01-02T03:04:05Z" },
];
const paths = ["docs", "a.txt", "b.txt"];

function listProps(overrides: Partial<ComponentProps<typeof EntryList>> = {}) {
  return {
    entries,
    paths,
    onOpenDir: vi.fn(),
    onPreview: vi.fn(),
    onMenu: vi.fn(),
    onToggle: vi.fn(),
    ...overrides,
  };
}

function gridProps(overrides: Partial<ComponentProps<typeof EntryGrid>> = {}) {
  return {
    entries,
    paths,
    onOpenDir: vi.fn(),
    onPreview: vi.fn(),
    onMenu: vi.fn(),
    onToggle: vi.fn(),
    ...overrides,
  };
}

describe("EntryList selection mode", () => {
  it("renders named checkboxes and hides per-entry menus", () => {
    render(<EntryList {...listProps({ selectionMode: true })} />);

    expect(screen.getByLabelText("Select docs")).toBeInTheDocument();
    expect(screen.getByLabelText("Select a.txt")).toBeInTheDocument();
    expect(screen.getByLabelText("Select b.txt")).toBeInTheDocument();
    expect(screen.queryByTestId("entry-actions")).not.toBeInTheDocument();
  });

  it("toggles on row tap without opening or previewing", async () => {
    const props = listProps({ selectionMode: true });
    const user = userEvent.setup();
    render(<EntryList {...props} />);

    await user.click(screen.getByTestId("entry-0"));
    expect(props.onToggle).toHaveBeenCalledWith("docs");
    expect(props.onOpenDir).not.toHaveBeenCalled();

    await user.click(screen.getByTestId("entry-1"));
    expect(props.onToggle).toHaveBeenCalledWith("a.txt");
    expect(props.onPreview).not.toHaveBeenCalled();
  });

  it("toggles once when the checkbox is clicked", async () => {
    const props = listProps({ selectionMode: true });
    const user = userEvent.setup();
    render(<EntryList {...props} />);

    await user.click(within(screen.getByTestId("entry-1")).getByTestId("entry-select"));
    expect(props.onToggle).toHaveBeenCalledTimes(1);
    expect(props.onToggle).toHaveBeenCalledWith("a.txt");
  });

  it("shows the selected state", () => {
    render(
      <EntryList
        {...listProps({ selectionMode: true, selected: new Set(["a.txt"]) })}
      />,
    );

    expect(within(screen.getByTestId("entry-1")).getByTestId("entry-select")).toBeChecked();
    expect(screen.getByTestId("entry-1")).toHaveAttribute("data-selected", "true");
    expect(within(screen.getByTestId("entry-0")).getByTestId("entry-select")).not.toBeChecked();
  });

  it("is keyboard operable", async () => {
    const props = listProps({ selectionMode: true });
    const user = userEvent.setup();
    render(<EntryList {...props} />);

    await user.tab();
    expect(within(screen.getByTestId("entry-0")).getByTestId("entry-select")).toHaveFocus();
    await user.keyboard(" ");
    expect(props.onToggle).toHaveBeenCalledWith("docs");
    expect(props.onOpenDir).not.toHaveBeenCalled();
  });

  it("does not open the entry menu on context menu", () => {
    const props = listProps({ selectionMode: true });
    render(<EntryList {...props} />);

    fireEvent.contextMenu(screen.getByTestId("entry-0"));
    expect(props.onMenu).not.toHaveBeenCalled();
  });

  it("keeps the normal open and menu behavior outside selection mode", async () => {
    const props = listProps();
    const user = userEvent.setup();
    render(<EntryList {...props} />);

    expect(screen.getAllByTestId("entry-actions")).toHaveLength(3);
    await user.click(within(screen.getByTestId("entry-1")).getByTestId("open-preview"));
    expect(props.onPreview).toHaveBeenCalledWith(entries[1], "a.txt");
  });
});

describe("EntryGrid selection mode", () => {
  it("renders checkboxes and toggles on tile tap without navigating", async () => {
    const props = gridProps({ selectionMode: true });
    const user = userEvent.setup();
    render(<EntryGrid {...props} />);

    expect(screen.queryByTestId("entry-actions")).not.toBeInTheDocument();
    await user.click(screen.getByTestId("entry-0"));
    expect(props.onToggle).toHaveBeenCalledWith("docs");
    expect(props.onOpenDir).not.toHaveBeenCalled();
  });

  it("shows the selected tile and toggles once from its checkbox", async () => {
    const onToggle = vi.fn();
    const user = userEvent.setup();
    render(
      <EntryGrid
        {...gridProps({
          selectionMode: true,
          selected: new Set(["a.txt"]),
          onToggle,
        })}
      />,
    );

    const cell = screen.getByTestId("entry-1");
    expect(within(cell).getByTestId("entry-select")).toBeChecked();
    expect(cell).toHaveAttribute("data-selected", "true");

    await user.click(within(cell).getByTestId("entry-select"));
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(onToggle).toHaveBeenCalledWith("a.txt");
  });

  it("suppresses the long-press menu", () => {
    const props = gridProps({ selectionMode: true });
    render(<EntryGrid {...props} />);

    fireEvent.contextMenu(screen.getByTestId("entry-0"));
    expect(props.onMenu).not.toHaveBeenCalled();
  });
});
