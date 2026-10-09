import type { ReactElement } from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import * as icons from "./icons";

const NAMED: Array<[string, (props: icons.IconProps) => ReactElement]> = [
  ["FolderIcon", icons.FolderIcon],
  ["FolderPlusIcon", icons.FolderPlusIcon],
  ["DocIcon", icons.DocIcon],
  ["FilmIcon", icons.FilmIcon],
  ["MusicIcon", icons.MusicIcon],
  ["ImageIcon", icons.ImageIcon],
  ["ChevronLeftIcon", icons.ChevronLeftIcon],
  ["ChevronRightIcon", icons.ChevronRightIcon],
  ["ChevronDownIcon", icons.ChevronDownIcon],
  ["PlusIcon", icons.PlusIcon],
  ["EllipsisIcon", icons.EllipsisIcon],
  ["TrashIcon", icons.TrashIcon],
  ["PencilIcon", icons.PencilIcon],
  ["TrayIcon", icons.TrayIcon],
  ["GearIcon", icons.GearIcon],
  ["LockIcon", icons.LockIcon],
  ["WifiIcon", icons.WifiIcon],
  ["WarningIcon", icons.WarningIcon],
  ["CheckIcon", icons.CheckIcon],
  ["PersonIcon", icons.PersonIcon],
];

describe("icon set", () => {
  it.each(NAMED)("renders %s with an accessible label when named", (_name, Icon) => {
    render(<Icon label="Descriptive label" />);
    expect(screen.getByRole("img", { name: "Descriptive label" })).toBeInTheDocument();
  });

  it("hides an unlabeled icon from assistive tech", () => {
    const { container } = render(<icons.FolderIcon />);
    const svg = container.querySelector("svg");
    expect(svg).toHaveAttribute("aria-hidden", "true");
    expect(svg).not.toHaveAttribute("role");
  });
});
