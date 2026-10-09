// Per-type visual for a listing entry (design D7): a tinted icon
// derived from the file extension. Media-ness for tap behavior still
// comes from filesApi.isMediaName; this is display only.

import type { ReactElement } from "react";
import type { LsEntry } from "../lib/filesApi";
import { DocIcon, FilmIcon, FolderIcon, ImageIcon, MusicIcon, type IconProps } from "./icons";

export type EntryVisual = {
  Icon: (p: IconProps) => ReactElement;
  tone: string;
};

const VIDEO = /\.(mp4|webm|ogv|mov|m4v)$/i;
const AUDIO = /\.(mp3|wav|m4a|ogg|weba|flac|aac)$/i;
const IMAGE = /\.(jpg|jpeg|png|gif|webp|heic|bmp|svg|dng)$/i;

export function entryVisual(entry: LsEntry): EntryVisual {
  if (entry.dir) return { Icon: FolderIcon, tone: "bg-ios-blue/10 text-ios-blue" };
  if (VIDEO.test(entry.name)) return { Icon: FilmIcon, tone: "bg-violet-50 text-violet-600" };
  if (AUDIO.test(entry.name)) return { Icon: MusicIcon, tone: "bg-pink-50 text-pink-600" };
  if (IMAGE.test(entry.name)) return { Icon: ImageIcon, tone: "bg-emerald-50 text-ios-green" };
  if (/\.pdf$/i.test(entry.name)) return { Icon: DocIcon, tone: "bg-orange-50 text-orange-600" };
  return { Icon: DocIcon, tone: "bg-ios-secondary/10 text-ios-secondary" };
}
