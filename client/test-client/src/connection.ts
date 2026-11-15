import { parseConnectionString } from "@stratofold/client";

import type { Connection } from "./config.js";

// Applies a pasted connection string without mutating the current
// connection. A malformed value throws from the package parser, so the
// caller can keep using the previous fields.
export function applyConnectionString(
  value: string,
  current: Connection,
): Connection {
  const parts = parseConnectionString(value);
  return {
    ...current,
    baseUrl: parts.baseUrl,
    vdir: parts.vdir,
    token: parts.token,
  };
}
