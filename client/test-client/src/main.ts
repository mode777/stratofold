import { StratofoldClient } from "@stratofold/client";

import {
  browserStores,
  loadConnection,
  saveConnection,
  type Connection,
} from "./config.js";
import {
  formatError,
  performOperation,
  type Hooks,
  type Operation,
} from "./operations.js";

const element = <T extends HTMLElement>(id: string): T => {
  const found = document.getElementById(id);
  if (!found) throw new Error(`missing element #${id}`);
  return found as T;
};

const baseUrlInput = element<HTMLInputElement>("baseUrl");
const vdirInput = element<HTMLInputElement>("vdir");
const tokenInput = element<HTMLInputElement>("token");
const pathInput = element<HTMLInputElement>("path");
const rangeInput = element<HTMLInputElement>("range");
const moveFromInput = element<HTMLInputElement>("moveFrom");
const moveToInput = element<HTMLInputElement>("moveTo");
const uploadFileInput = element<HTMLInputElement>("uploadFile");
const uploadPathInput = element<HTMLInputElement>("uploadPath");
const progress = element<HTMLProgressElement>("progress");
const progressText = element<HTMLParagraphElement>("progressText");
const logElement = element<HTMLPreElement>("log");
const modeHint = element<HTMLParagraphElement>("modeHint");
const cancelUploadButton = element<HTMLButtonElement>("cancelUpload");
const discoverButton = element<HTMLButtonElement>("discover");
const temporaryUrlButton = element<HTMLButtonElement>("temporaryUrl");

// Local development may prefill from a gitignored .env.local. The Vite
// config refuses a production build while any of these are set, and
// import.meta.env.DEV is folded away in production, so the values never
// reach a deployable bundle.
const devDefaults: Connection = import.meta.env.DEV
  ? {
      baseUrl: import.meta.env.VITE_SF_BASE_URL ?? "",
      token: import.meta.env.VITE_SF_TOKEN ?? "",
      vdir: import.meta.env.VITE_SF_VDIR ?? "",
    }
  : { baseUrl: "", token: "", vdir: "" };

const stored = loadConnection(browserStores());
const connection: Connection = {
  baseUrl: stored.baseUrl || devDefaults.baseUrl,
  token: stored.token || devDefaults.token,
  vdir: stored.vdir || devDefaults.vdir,
};

let uploadController: AbortController | null = null;

baseUrlInput.value = connection.baseUrl;
vdirInput.value = connection.vdir;
tokenInput.value = connection.token;

function syncConnection(): Connection {
  connection.baseUrl = baseUrlInput.value.trim();
  connection.token = tokenInput.value.trim();
  connection.vdir = vdirInput.value.trim();
  saveConnection(connection, browserStores());
  updateMode();
  return connection;
}

function updateMode(): void {
  const hasToken = tokenInput.value.trim().length > 0;
  modeHint.textContent = hasToken
    ? "Bearer mode: the token is sent only in the Authorization header."
    : "Public mode: listing and reading only; token-only actions are disabled.";
  discoverButton.disabled = !hasToken;
  temporaryUrlButton.disabled = !hasToken;
}

function client(): StratofoldClient {
  return new StratofoldClient({
    baseUrl: connection.baseUrl,
    // Scope discovery works before the vdir is known; the placeholder
    // never reaches a vdir-scoped request.
    vdir: connection.vdir || "unresolved",
    token: connection.token || undefined,
  });
}

function logLine(text: string): void {
  logElement.textContent += `${text}\n`;
  logElement.scrollTop = logElement.scrollHeight;
}

function logLink(text: string, url: string): void {
  logElement.append(document.createTextNode(`${text} `));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.textContent = url;
  anchor.target = "_blank";
  anchor.rel = "noreferrer";
  logElement.append(anchor, document.createTextNode("\n"));
  logElement.scrollTop = logElement.scrollHeight;
}

async function run(label: string, work: () => Promise<void>): Promise<void> {
  try {
    await work();
  } catch (error) {
    logLine(`${label} failed — ${formatError(error)}`);
  }
}

async function saveBlob(response: Response, name: string): Promise<void> {
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name || "download";
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

async function execute(operation: Operation, hooks: Hooks = {}): Promise<void> {
  const result = await performOperation(client(), operation, hooks);
  logLine(result.summary);
  if (result.response) {
    const name = operation.kind === "read"
      ? operation.path.split("/").filter(Boolean).pop() ?? "download"
      : "download";
    await saveBlob(result.response, name);
    logLine(`saved ${name}`);
  }
  if (result.temporaryUrl) {
    logLink("open:", result.temporaryUrl);
  }
}

element<HTMLButtonElement>("save").addEventListener("click", () => {
  syncConnection();
  logLine(`connection saved for ${connection.baseUrl || "(no base URL)"}`);
});

baseUrlInput.addEventListener("change", () => syncConnection());
vdirInput.addEventListener("change", () => syncConnection());
tokenInput.addEventListener("input", () => updateMode());
tokenInput.addEventListener("change", () => syncConnection());

discoverButton.addEventListener("click", () => {
  void run("scope discovery", async () => {
    syncConnection();
    const info = await client().tokenInfo();
    vdirInput.value = info.vdir.id;
    connection.vdir = info.vdir.id;
    saveConnection(connection, browserStores());
    logLine(
      `token ${info.name} (${info.tokenHint}) → vdir ${info.vdir.name} (${info.vdir.id}), role ${info.role}, expires ${info.expiresAt ?? "never"}`,
    );
  });
});

element<HTMLButtonElement>("list").addEventListener("click", () => {
  void run("list", () =>
    execute({ kind: "list", path: pathInput.value.trim() }),
  );
});

element<HTMLButtonElement>("read").addEventListener("click", () => {
  void run("read", () =>
    execute({
      kind: "read",
      path: pathInput.value.trim(),
      range: rangeInput.value.trim() || undefined,
    }),
  );
});

element<HTMLButtonElement>("fileUrl").addEventListener("click", () => {
  void run("plain URL", () =>
    execute({ kind: "fileUrl", path: pathInput.value.trim() }),
  );
});

element<HTMLButtonElement>("mkdir").addEventListener("click", () => {
  void run("mkdir", () =>
    execute({ kind: "mkdir", path: pathInput.value.trim() }),
  );
});

element<HTMLButtonElement>("remove").addEventListener("click", () => {
  void run("remove", () =>
    execute({ kind: "remove", path: pathInput.value.trim() }),
  );
});

element<HTMLButtonElement>("move").addEventListener("click", () => {
  void run("move", () =>
    execute({
      kind: "move",
      from: moveFromInput.value.trim(),
      to: moveToInput.value.trim(),
    }),
  );
});

temporaryUrlButton.addEventListener("click", () => {
  void run("temporary URL", () =>
    execute({ kind: "temporaryUrl", path: pathInput.value.trim() }),
  );
});

element<HTMLButtonElement>("upload").addEventListener("click", () => {
  void run("upload", async () => {
    const file = uploadFileInput.files?.[0];
    if (!file) {
      logLine("upload failed — choose a file first");
      return;
    }
    const target = uploadPathInput.value.trim() || file.name;
    uploadController = new AbortController();
    cancelUploadButton.disabled = false;
    progress.hidden = false;
    progress.value = 0;
    progressText.textContent = `uploading ${target}…`;
    try {
      await execute(
        { kind: "upload", path: target, body: file },
        {
          signal: uploadController.signal,
          onProgress: (loaded, total) => {
            progress.value = total > 0 ? loaded / total : 0;
            progressText.textContent = `${loaded} / ${total} bytes`;
          },
        },
      );
      progressText.textContent = `uploaded ${target}`;
    } finally {
      uploadController = null;
      cancelUploadButton.disabled = true;
    }
  });
});

cancelUploadButton.addEventListener("click", () => {
  uploadController?.abort();
});

element<HTMLButtonElement>("clearLog").addEventListener("click", () => {
  logElement.textContent = "";
});

updateMode();
logLine("Stratofold client test — fill in a server, token, and vdir.");
