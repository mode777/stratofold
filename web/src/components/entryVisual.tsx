// Per-type visual for a listing entry (design D7): a tinted icon
// derived from the file's kind (lib/entryKind, design D2 of
// add-audio-player-image-viewer). Display only — tap behavior is
// decided by the same kind at the entry views.

import type { ReactElement } from "react";
import type { LsEntry } from "../lib/filesApi";
import { entryKind, type EntryKind } from "../lib/entryKind";
import { DocIcon, FilmIcon, FolderIcon, ImageIcon, MusicIcon, type IconProps } from "./icons";

export type EntryVisual = {
  Icon: (p: IconProps) => ReactElement;
  tone: string;
};

const TONES: Record<Exclude<EntryKind, "dir">, EntryVisual> = {
  audio: { Icon: MusicIcon, tone: "bg-pink-50 text-pink-600" },
  image: { Icon: ImageIcon, tone: "bg-emerald-50 text-ios-green" },
  video: { Icon: FilmIcon, tone: "bg-violet-50 text-violet-600" },
  // PDFs keep their own accent within the generic document kind.
  other: { Icon: DocIcon, tone: "bg-ios-secondary/10 text-ios-secondary" },
};

export function entryVisual(entry: LsEntry): EntryVisual {
  const kind = entryKind(entry.name, entry.dir);
  if (kind === "dir") return { Icon: FolderIcon, tone: "bg-ios-blue/10 text-ios-blue" };
  if (!entry.dir && /\.pdf$/i.test(entry.name)) {
    return { Icon: DocIcon, tone: "bg-orange-50 text-orange-600" };
  }
  return TONES[kind];
}
