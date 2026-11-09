import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { describe, expect, it } from "vitest";

import {
  ConfigurationError,
  StratofoldClient,
  StratofoldError,
  UploadCanceled,
} from "../dist/index.js";

const iifePath = fileURLToPath(new URL("../dist/stratofold.min.js", import.meta.url));

describe("published artifacts", () => {
  it("ESM build exposes the public API", () => {
    expect(typeof StratofoldClient).toBe("function");
    expect(typeof StratofoldError).toBe("function");
    expect(typeof UploadCanceled).toBe("function");
    expect(typeof ConfigurationError).toBe("function");
  });

  it("IIFE build exposes the documented Stratofold global", () => {
    const context: Record<string, unknown> = {};
    vm.runInNewContext(readFileSync(iifePath, "utf8"), context);
    const global = context.Stratofold as Record<string, unknown> | undefined;
    expect(global).toBeDefined();
    expect(typeof global?.StratofoldClient).toBe("function");
    expect(typeof global?.StratofoldError).toBe("function");
    expect(typeof global?.UploadCanceled).toBe("function");
  });
});
