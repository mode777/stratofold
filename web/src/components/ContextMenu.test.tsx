import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ContextMenu } from "./ContextMenu";
import type { LsEntry } from "../lib/filesApi";

function entry(name: string, over: Partial<LsEntry> = {}): LsEntry {
  return { name, size: 10, dir: false, modtime: "2026-01-02T03:04:05Z", ...over };
}

type Props = Parameters<typeof ContextMenu>[0];

function renderMenu(name: string, over: Partial<LsEntry> = {}, rest: Partial<Props> = {}) {
  const onPreview = vi.fn();
  const onOpenDir = vi.fn();
  render(
    <ContextMenu
      entry={entry(name, over)}
      path={`folder/${name}`}
      vdirId="v1"
      canWrite={false}
      onOpenDir={onOpenDir}
      onPreview={onPreview}
      onRename={vi.fn()}
      onMove={vi.fn()}
      onDelete={vi.fn()}
      onClose={vi.fn()}
      {...rest}
    />,
  );
  return { onPreview, onOpenDir };
}

describe("ContextMenu", () => {
  it("opens audio in-app through the player route and keeps Download", async () => {
    const { onPreview } = renderMenu("song.mp3");

    expect(screen.getByTestId("action-open")).toBeInTheDocument();
    expect(screen.queryByTestId("action-open-tab")).not.toBeInTheDocument();
    expect(screen.getByText("Audio")).toBeInTheDocument();

    await userEvent.setup().click(screen.getByTestId("action-open"));
    expect(onPreview).toHaveBeenCalledWith(expect.objectContaining({ name: "song.mp3" }), "folder/song.mp3");

    const download = screen.getByTestId("action-download");
    expect(download).toHaveAttribute("href", "/files/v1/folder/song.mp3");
    expect(download).toHaveAttribute("download");
  });

  it("opens images in-app through the viewer route and keeps Download", async () => {
    const { onPreview } = renderMenu("hero.png");

    await userEvent.setup().click(screen.getByTestId("action-open"));
    expect(onPreview).toHaveBeenCalledWith(expect.objectContaining({ name: "hero.png" }), "folder/hero.png");
    expect(screen.getByTestId("action-download")).toHaveAttribute("href", "/files/v1/folder/hero.png");
    expect(screen.getByText("Image")).toBeInTheDocument();
  });

  it("sends video to a new tab and keeps Download", async () => {
    renderMenu("movie.mp4");

    expect(screen.getByTestId("action-open-tab")).toHaveAttribute("href", "/files/v1/folder/movie.mp4");
    expect(screen.getByTestId("action-open-tab")).toHaveAttribute("target", "_blank");
    expect(screen.queryByTestId("action-open")).not.toBeInTheDocument();
    expect(screen.getByTestId("action-download")).toHaveAttribute("href", "/files/v1/folder/movie.mp4");
    expect(screen.getByText("Video")).toBeInTheDocument();
  });

  it("previews other files in-app and keeps Download", async () => {
    const { onPreview } = renderMenu("notes.txt");

    await userEvent.setup().click(screen.getByTestId("action-open"));
    expect(onPreview).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("action-download")).toBeInTheDocument();
    expect(screen.getByText("File")).toBeInTheDocument();
  });

  it("opens directories and offers no download for them", async () => {
    const { onOpenDir } = renderMenu("docs", { dir: true });

    expect(screen.queryByTestId("action-download")).not.toBeInTheDocument();
    expect(screen.getByText("Folder")).toBeInTheDocument();

    await userEvent.setup().click(screen.getByTestId("action-open"));
    expect(onOpenDir).toHaveBeenCalledWith("folder/docs");
  });

  it("offers no write actions when the user may not write", () => {
    renderMenu("notes.txt");

    expect(screen.queryByTestId("action-rename")).not.toBeInTheDocument();
    expect(screen.queryByTestId("action-move")).not.toBeInTheDocument();
    expect(screen.queryByTestId("action-delete")).not.toBeInTheDocument();
  });
});
