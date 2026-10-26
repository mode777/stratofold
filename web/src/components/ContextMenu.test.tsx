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

  it("opens video in-app and keeps the raw new-tab action and Download", async () => {
    const { onPreview } = renderMenu("movie.mp4");

    expect(screen.getByTestId("action-open-tab")).toHaveAttribute("href", "/files/v1/folder/movie.mp4");
    expect(screen.getByTestId("action-open-tab")).toHaveAttribute("target", "_blank");
    await userEvent.setup().click(screen.getByTestId("action-open"));
    expect(onPreview).toHaveBeenCalledWith(expect.objectContaining({ name: "movie.mp4" }), "folder/movie.mp4");
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

  it("copies the file's absolute direct URL on a public vdir", async () => {
    renderMenu("my notes.txt", {}, { isPublic: true });

    const copy = screen.getByTestId("action-copy-public-link");
    expect(copy).toHaveTextContent("Copy public link");

    await userEvent.setup().click(copy);

    expect(copy).toHaveTextContent("Copied");
    await expect(navigator.clipboard.readText()).resolves.toBe(
      `${window.location.origin}/files/v1/folder/my%20notes.txt`,
    );
  });

  it("keeps the copy action for every viewer of a public vdir", () => {
    renderMenu("notes.txt", {}, { isPublic: true, canWrite: false });
    expect(screen.getByTestId("action-copy-public-link")).toBeInTheDocument();
  });

  it("offers no copy action on a non-public vdir", () => {
    renderMenu("notes.txt");
    expect(screen.queryByTestId("action-copy-public-link")).not.toBeInTheDocument();
  });

  it("offers no copy action for directories on a public vdir", () => {
    renderMenu("docs", { dir: true }, { isPublic: true });
    expect(screen.queryByTestId("action-copy-public-link")).not.toBeInTheDocument();
  });

  it("copies a minted 24-hour link on a non-public vdir", async () => {
    const onCopyTemporaryLink = vi.fn(async () => true);
    renderMenu("notes.txt", {}, { canMintLink: true, onCopyTemporaryLink });

    const copy = screen.getByTestId("action-copy-temp-link");
    expect(copy).toHaveTextContent("Copy 24-hour link");
    expect(screen.queryByTestId("action-copy-public-link")).not.toBeInTheDocument();

    await userEvent.setup().click(copy);
    expect(onCopyTemporaryLink).toHaveBeenCalledWith("folder/notes.txt");
    expect(copy).toHaveTextContent("Copied");
  });

  it("offers no temporary link without the reader gate", () => {
    renderMenu("notes.txt");
    expect(screen.queryByTestId("action-copy-temp-link")).not.toBeInTheDocument();
  });

  it("offers no temporary link for directories", () => {
    renderMenu("docs", { dir: true }, { canMintLink: true, onCopyTemporaryLink: vi.fn(async () => true) });
    expect(screen.queryByTestId("action-copy-temp-link")).not.toBeInTheDocument();
  });

  it("claims no success when the mint fails", async () => {
    const onCopyTemporaryLink = vi.fn(async () => false);
    renderMenu("notes.txt", {}, { canMintLink: true, onCopyTemporaryLink });

    const copy = screen.getByTestId("action-copy-temp-link");
    await userEvent.setup().click(copy);
    expect(copy).toHaveTextContent("Copy 24-hour link");
    expect(screen.getByTestId("action-download")).toBeInTheDocument();
  });

  it("claims no success when the copy callback rejects", async () => {
    const onCopyTemporaryLink = vi.fn(async () => {
      throw new Error("clipboard denied");
    });
    renderMenu("notes.txt", {}, { canMintLink: true, onCopyTemporaryLink });

    const copy = screen.getByTestId("action-copy-temp-link");
    await userEvent.setup().click(copy);
    expect(copy).toHaveTextContent("Copy 24-hour link");
    expect(screen.getByTestId("action-download")).toBeInTheDocument();
  });

  it("claims no success when the clipboard write rejects", async () => {
    const user = userEvent.setup();
    vi.spyOn(navigator.clipboard, "writeText").mockRejectedValueOnce(new Error("denied"));
    renderMenu("notes.txt", {}, { isPublic: true });

    const copy = screen.getByTestId("action-copy-public-link");
    await user.click(copy);

    expect(copy).toHaveTextContent("Copy public link");
    expect(screen.queryByText("Copied")).not.toBeInTheDocument();
    expect(screen.getByTestId("action-download")).toBeInTheDocument();
  });
});
