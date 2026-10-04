import PocketBase from "pocketbase";

// Same-origin by default (design D2): the SDK talks to the same origin
// the page was served from — the Vite dev proxy in development, the
// Go binary (pb_public / change 9's go:embed) in production.
export const pb = new PocketBase();
