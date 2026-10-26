// File-kind classification (design D2): the single source of truth for
// how an entry name maps to a playback/display kind. Replaces the two
// divergent extension sets that used to live in filesApi.isMediaName
// (tap behavior) and entryVisual (display) — audio entries now open
// the in-app player, images the in-app viewer, and video keeps the
// new-tab native player.

export type EntryKind = "dir" | "audio" | "image" | "video" | "other";

const AUDIO = /\.(mp3|wav|m4a|ogg|weba|flac|aac)$/i;
const IMAGE = /\.(jpg|jpeg|png|gif|webp|heic|bmp|svg|dng)$/i;
const VIDEO = /\.(mp4|webm|ogv|mov|m4v)$/i;

// entryKind classifies one listing entry. Directories pass dir=true;
// the extension sets apply to file names only.
export function entryKind(name: string, dir = false): EntryKind {
  if (dir) return "dir";
  if (AUDIO.test(name)) return "audio";
  if (IMAGE.test(name)) return "image";
  if (VIDEO.test(name)) return "video";
  return "other";
}

// videoContentType is the receiver-facing content type for the video
// set (add-chromecast-playback): m4v is an MP4 container, ogv is Ogg.
export function videoContentType(name: string): string {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  switch (ext) {
    case "mp4":
    case "m4v":
      return "video/mp4";
    case "webm":
      return "video/webm";
    case "mov":
      return "video/quicktime";
    case "ogv":
      return "video/ogg";
    default:
      return "application/octet-stream";
  }
}
