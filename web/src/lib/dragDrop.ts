// Drag payload traversal (web-ui drag & drop spec, design D1): turns a
// drop's DataTransfer into an upload plan relative to the drop root.
// Folders are represented only by the entries API, so entries are
// collected synchronously — the DataTransferItemList is invalidated once
// the drop handler returns — and traversed afterwards. Directory readers
// page their children (the browser returns at most 100 per call), so the
// loop continues until a batch comes back empty.

export type DragDropFile = { path: string; file: File };

export type DragDropPlan = {
  // Relative paths, parents before children; empty folders included.
  folders: string[];
  files: DragDropFile[];
  // Relative paths of entries that could not be read.
  failures: string[];
};

// DropItem is the structural slice of DataTransferItem the traversal
// needs; DropData is the structural slice of DataTransfer, which keeps
// the traversal unit-testable with plain objects.
export type DropItem = {
  webkitGetAsEntry?: () => FileSystemEntry | null;
  getAsFile?: () => File | null;
};

export type DropData = {
  items?: ArrayLike<DropItem> | null;
  files?: ArrayLike<File> | null;
};

type Collected = { entry: FileSystemEntry } | { file: File };

// collectDrop reads the payload synchronously — call it (through
// readDrop) inside the drop handler, before any await.
export function collectDrop(data: DropData): Collected[] {
  const collected: Collected[] = [];
  const items = data.items;
  if (items) {
    for (let i = 0; i < items.length; i += 1) {
      const item = items[i];
      const entry = item?.webkitGetAsEntry?.() ?? null;
      if (entry) {
        collected.push({ entry });
        continue;
      }
      const file = item?.getAsFile?.() ?? null;
      if (file) collected.push({ file });
    }
  }
  if (collected.length === 0 && data.files) {
    for (let i = 0; i < data.files.length; i += 1) {
      collected.push({ file: data.files[i] });
    }
  }
  return collected;
}

function joinRel(prefix: string, name: string): string {
  return prefix ? `${prefix}/${name}` : name;
}

function readDirectory(entry: FileSystemDirectoryEntry): Promise<FileSystemEntry[]> {
  return new Promise((resolve, reject) => {
    const reader = entry.createReader();
    const all: FileSystemEntry[] = [];
    const next = () => {
      reader.readEntries((batch) => {
        if (batch.length === 0) {
          resolve(all);
          return;
        }
        all.push(...batch);
        next();
      }, reject);
    };
    next();
  });
}

function readFile(entry: FileSystemFileEntry): Promise<File> {
  return new Promise((resolve, reject) => entry.file(resolve, reject));
}

async function walk(entry: FileSystemEntry, prefix: string, plan: DragDropPlan): Promise<void> {
  const path = joinRel(prefix, entry.name);
  if (entry.isFile) {
    try {
      plan.files.push({ path, file: await readFile(entry as FileSystemFileEntry) });
    } catch {
      plan.failures.push(path);
    }
    return;
  }
  if (!entry.isDirectory) {
    plan.failures.push(path);
    return;
  }
  // Read the children before claiming the folder: a folder we cannot
  // enumerate must not be created as an empty directory.
  let children: FileSystemEntry[];
  try {
    children = await readDirectory(entry as FileSystemDirectoryEntry);
  } catch {
    plan.failures.push(path);
    return;
  }
  plan.folders.push(path);
  for (const child of children) await walk(child, path, plan);
}

export async function traverseDrop(collected: Collected[]): Promise<DragDropPlan> {
  const plan: DragDropPlan = { folders: [], files: [], failures: [] };
  for (const item of collected) {
    if ("file" in item) {
      plan.files.push({ path: item.file.name, file: item.file });
    } else {
      await walk(item.entry, "", plan);
    }
  }
  return plan;
}

// readDrop is the drop handler's entry point: it collects synchronously
// and only then awaits the traversal.
export async function readDrop(data: DropData): Promise<DragDropPlan> {
  return traverseDrop(collectDrop(data));
}
