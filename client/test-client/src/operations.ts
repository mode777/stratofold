import type { StratofoldClient } from "@stratofold/client";

// One user-triggerable operation. Kept separate from the DOM so the
// dispatch is unit-testable with a fake client.
export type Operation =
  | { kind: "list"; path: string }
  | { kind: "read"; path: string; range?: string }
  | { kind: "mkdir"; path: string }
  | { kind: "move"; from: string; to: string }
  | { kind: "remove"; path: string }
  | { kind: "upload"; path: string; body: Blob }
  | { kind: "scope" }
  | { kind: "temporaryUrl"; path: string }
  | { kind: "fileUrl"; path: string };

export type Hooks = {
  onProgress?: (loaded: number, total: number) => void;
  signal?: AbortSignal;
};

export type OperationResult = {
  summary: string;
  /** Present for reads so the UI can offer the downloaded body. */
  response?: Response;
  /** Present for a minted temporary URL. */
  temporaryUrl?: string;
};

export async function performOperation(
  client: StratofoldClient,
  operation: Operation,
  hooks: Hooks = {},
): Promise<OperationResult> {
  switch (operation.kind) {
    case "list": {
      const entries = await client.list(operation.path);
      const lines = entries.map(
        (entry) =>
          `${entry.dir ? "dir " : "file"}  ${entry.size.toString().padStart(10)}  ${entry.name}`,
      );
      return {
        summary: `${entries.length} entr${entries.length === 1 ? "y" : "ies"} in ${operation.path || "/"}\n${lines.join("\n")}`,
      };
    }
    case "read": {
      const headers = operation.range ? { Range: operation.range } : undefined;
      const response = await client.read(operation.path, { headers });
      const length = response.headers.get("Content-Length") ?? "unknown";
      const range = response.headers.get("Content-Range");
      return {
        response,
        summary:
          `read ${operation.path}: HTTP ${response.status}, ${length} byte(s)` +
          (range ? `, ${range}` : ""),
      };
    }
    case "mkdir": {
      await client.mkdir(operation.path);
      return { summary: `mkdir ${operation.path}: done` };
    }
    case "move": {
      await client.move(operation.from, operation.to);
      return { summary: `move ${operation.from} -> ${operation.to}: done` };
    }
    case "remove": {
      await client.remove(operation.path);
      return { summary: `remove ${operation.path}: done` };
    }
    case "upload": {
      const result = await client.upload(operation.path, operation.body, {
        onProgress: hooks.onProgress,
        signal: hooks.signal,
      });
      return { summary: `upload ${result.path}: ${result.size} byte(s)` };
    }
    case "scope": {
      const info = await client.tokenInfo();
      return {
        summary: [
          `token ${info.name} (${info.tokenHint})`,
          `vdir ${info.vdir.name} (${info.vdir.id})`,
          `role ${info.role}`,
          `expires ${info.expiresAt ?? "never"}`,
          `last used ${info.lastUsedAt ?? "never"}`,
        ].join("\n"),
      };
    }
    case "temporaryUrl": {
      const link = await client.temporaryUrl(operation.path);
      return {
        temporaryUrl: link.url,
        summary: `temporary URL until ${link.expiresAt}\n${link.url}`,
      };
    }
    case "fileUrl": {
      return { summary: client.fileUrl(operation.path) };
    }
  }
}

/** Formats any thrown value for the result log. */
export function formatError(error: unknown): string {
  if (error instanceof Error) {
    const kind = (error as { kind?: unknown }).kind;
    const status = (error as { status?: unknown }).status;
    if (typeof kind === "string") {
      return `${error.name} [${kind}${typeof status === "number" ? ` ${status}` : ""}]: ${error.message}`;
    }
    return `${error.name}: ${error.message}`;
  }
  return String(error);
}
