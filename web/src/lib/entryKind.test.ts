import { describe, expect, it } from "vitest";
import { entryKind } from "./entryKind";

describe("entryKind", () => {
  it("classifies directories before extensions", () => {
    expect(entryKind("folder.mp3", true)).toBe("dir");
    expect(entryKind("anything", true)).toBe("dir");
  });

  it("classifies the audio set", () => {
    for (const name of [
      "song.mp3",
      "tone.wav",
      "voice.m4a",
      "cast.ogg",
      "clip.weba",
      "lossless.flac",
      "book.aac",
    ]) {
      expect(entryKind(name)).toBe("audio");
    }
  });

  it("classifies the image set", () => {
    for (const name of [
      "photo.jpg",
      "photo.jpeg",
      "shot.png",
      "anim.gif",
      "modern.webp",
      "phone.heic",
      "paint.bmp",
      "vector.svg",
      "raw.dng",
    ]) {
      expect(entryKind(name)).toBe("image");
    }
  });

  it("classifies the video set", () => {
    for (const name of ["movie.mp4", "clip.webm", "film.ogv", "take.mov", "clip.m4v"]) {
      expect(entryKind(name)).toBe("video");
    }
  });

  it("separates ogg audio from ogv video", () => {
    expect(entryKind("track.ogg")).toBe("audio");
    expect(entryKind("screen.ogv")).toBe("video");
  });

  it("is case-insensitive", () => {
    expect(entryKind("SONG.MP3")).toBe("audio");
    expect(entryKind("Photo.JPG")).toBe("image");
    expect(entryKind("Movie.Mp4")).toBe("video");
  });

  it("maps unknown or extension-less names to other", () => {
    expect(entryKind("notes.txt")).toBe("other");
    expect(entryKind("archive.zip")).toBe("other");
    expect(entryKind("README")).toBe("other");
    expect(entryKind("trailingdot.")).toBe("other");
  });
});
