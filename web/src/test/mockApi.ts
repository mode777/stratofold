// Test helpers: a configurable PocketBase transport mock and a fetch
// router for the /api/sf/* surface. Not a test file (no *.test.*), so
// vitest does not collect it.

import { vi } from "vitest";
import { pb } from "../lib/pb";

export type SendOptions = {
  method?: string;
  body?: unknown;
  query?: Record<string, unknown>;
};

export type SendHandler = (path: string, options: SendOptions) => unknown | undefined;

export function installPbMock(handlers: SendHandler[]) {
  return vi.spyOn(pb, "send").mockImplementation(async (path: string, options?: SendOptions) => {
    for (const handler of handlers) {
      const result = handler(path, options ?? {});
      if (result !== undefined) return result;
    }
    throw new Error(`unexpected pb.send: ${options?.method ?? "GET"} ${path}`);
  });
}

export function listOf(items: unknown[]): { items: unknown[]; page: number; perPage: number; totalItems: number } {
  return { items, page: 1, perPage: 1000, totalItems: items.length };
}

export function authRefresh(user: { id: string; email: string }): SendHandler {
  return (path) => {
    if (path.includes("/auth-refresh")) {
      return { token: pb.authStore.token, record: user };
    }
    return undefined;
  };
}

export function collectionList(collection: string, items: unknown[]): SendHandler {
  return (path, options) => {
    if (path.includes(`/collections/${collection}/records`) && (options.method ?? "GET") === "GET") {
      return listOf(items);
    }
    return undefined;
  };
}

export function failWith(status: number, message: string): SendHandler {
  return () => {
    throw Object.assign(new Error(message), { status, response: { message } });
  };
}

export function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export type FetchRoute = (url: string, init?: RequestInit) => Response | undefined;

export function installFetchMock(routes: FetchRoute[]) {
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    for (const route of routes) {
      const resp = route(url, init);
      if (resp) return resp;
    }
    return jsonResponse(404, { message: "unrouted" });
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}
