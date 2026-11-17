import { describe, expect, it } from "vitest";
import { collectDrop, readDrop, type DropData } from "./dragDrop";

// Fake entries mirror the structural slice of the FileSystemEntry API
// the traversal uses; the casts keep the fakes readable.
function fileEntry(name: string, content = name): FileSystemEntry {
  return {
    name,
    isFile: true,
    isDirectory: false,
    file: (ok: (file: File) => void) => ok(new File([content], name)),
  } as unknown as FileSystemEntry;
}

function failingFileEntry(name: string): FileSystemEntry {
  return {
    name,
    isFile: true,
    isDirectory: false,
    file: (_ok: unknown, fail: (error: unknown) => void) => fail(new Error("unreadable")),
  } as unknown as FileSystemEntry;
}

function dirEntry(name: string, children: FileSystemEntry[], batchSize?: number): FileSystemEntry {
  return {
    name,
    isFile: false,
    isDirectory: true,
    createReader: () => {
      let cursor = 0;
      return {
        readEntries: (ok: (batch: FileSystemEntry[]) => void) => {
          const size = batchSize ?? (children.length || 1);
          const batch = children.slice(cursor, cursor + size);
          cursor += batch.length;
          ok(batch);
        },
      };
    },
  } as unknown as FileSystemEntry;
}

function failingDirEntry(name: string): FileSystemEntry {
  return {
    name,
    isFile: false,
    isDirectory: true,
    createReader: () => ({
      readEntries: (_ok: unknown, fail: (error: unknown) => void) => fail(new Error("denied")),
    }),
  } as unknown as FileSystemEntry;
}

function drop(entries: Array<FileSystemEntry | File>, opts: { withItems?: boolean } = {}): DropData {
  const withItems = opts.withItems ?? true;
  if (!withItems) return { items: [], files: entries.filter((e): e is File => e instanceof File) };
  const items = entries.map((entry) =>
    entry instanceof File
      ? { getAsFile: () => entry }
      : { webkitGetAsEntry: () => entry },
  );
  return { items, files: [] };
}

describe("readDrop traversal", () => {
  it("preserves a nested folder tree with the folder name as root", async () => {
    const photos = dirEntry("photos", [
      dirEntry("sub", [fileEntry("a.jpg", "a")]),
      fileEntry("b.jpg", "b"),
    ]);
    const plan = await readDrop(drop([photos]));

    expect(plan.folders).toEqual(["photos", "photos/sub"]);
    expect(plan.files.map((f) => f.path)).toEqual(["photos/sub/a.jpg", "photos/b.jpg"]);
    expect(await plan.files[0].file.text()).toBe("a");
    expect(plan.failures).toEqual([]);
  });

  it("pages directory reads until an empty batch", async () => {
    const children = Array.from({ length: 150 }, (_, i) => fileEntry(`f${i}.txt`));
    const plan = await readDrop(drop([dirEntry("big", children, 100)]));

    expect(plan.folders).toEqual(["big"]);
    expect(plan.files).toHaveLength(150);
    expect(plan.files[149].path).toBe("big/f149.txt");
  });

  it("supports a mixed drop of files and folders", async () => {
    const plan = await readDrop(
      drop([fileEntry("note.txt", "hi"), dirEntry("folder", [fileEntry("x.txt")])]),
    );

    expect(plan.files.map((f) => f.path)).toEqual(["note.txt", "folder/x.txt"]);
    expect(plan.folders).toEqual(["folder"]);
  });

  it("keeps an empty folder in the plan", async () => {
    const plan = await readDrop(drop([dirEntry("empty", [])]));

    expect(plan.folders).toEqual(["empty"]);
    expect(plan.files).toEqual([]);
    expect(plan.failures).toEqual([]);
  });

  it("records an unreadable folder and keeps its sibling", async () => {
    const plan = await readDrop(
      drop([failingDirEntry("locked"), dirEntry("open", [fileEntry("ok.txt")])]),
    );

    expect(plan.folders).toEqual(["open"]);
    expect(plan.files.map((f) => f.path)).toEqual(["open/ok.txt"]);
    expect(plan.failures).toEqual(["locked"]);
  });

  it("records an unreadable file entry without dropping the others", async () => {
    const plan = await readDrop(drop([failingFileEntry("broken.bin"), fileEntry("ok.bin")]));

    expect(plan.files.map((f) => f.path)).toEqual(["ok.bin"]);
    expect(plan.failures).toEqual(["broken.bin"]);
    // A file that could not be read is not also a folder.
    expect(plan.folders).toEqual([]);
  });

  it("falls back to flat files when no entry is available", async () => {
    const plan = await readDrop(
      drop([new File(["a"], "a.txt"), new File(["b"], "b.txt")], { withItems: false }),
    );

    expect(plan.files.map((f) => f.path)).toEqual(["a.txt", "b.txt"]);
    expect(plan.folders).toEqual([]);
    expect(plan.failures).toEqual([]);
  });

  it("ignores a payload that carries no files", async () => {
    const data: DropData = {
      items: [{ getAsFile: () => null }],
      files: [],
    };
    const plan = await readDrop(data);

    expect(plan).toEqual({ folders: [], files: [], failures: [] });
  });

  it("collects entries synchronously before the traversal awaits", async () => {
    let called = 0;
    const data: DropData = {
      items: [
        {
          webkitGetAsEntry: () => {
            called += 1;
            return fileEntry("sync.txt");
          },
        },
      ],
      files: [],
    };

    const pending = readDrop(data);
    expect(called).toBe(1);
    expect(collectDrop(data)).toHaveLength(1);
    await pending;
  });
});
