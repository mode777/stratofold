// Public entry point for @stratofold/client. The IIFE build exposes this
// module's exports as the `Stratofold` global.

export { StratofoldClient } from "./client.js";
export { parseConnectionString } from "./connectionString.js";
export {
  ConfigurationError,
  StratofoldError,
  UploadCanceled,
  failureFor,
  failureKind,
} from "./errors.js";
export type { FailureKind } from "./errors.js";
export type { ConnectionStringParts } from "./connectionString.js";
export type {
  ConnectionStringOverrides,
  FetchLike,
  LsEntry,
  ReadOptions,
  StatEntry,
  StatOptions,
  StratofoldOptions,
  TemporaryUrl,
  TokenInfo,
  UploadBody,
  UploadOptions,
  UploadResult,
} from "./types.js";
