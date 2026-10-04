// File-management dialogs (web-ui spec, design D5): create folder,
// rename, move, and delete over the filesystem API. Each reuses Dialog
// and FailureState so the deterministic error classes render as the
// established states, with a working retry on 503.

import { useState, type FormEvent, type ReactNode } from "react";
import { mkdir, mv, rm, type ApiFailure, type LsEntry } from "../lib/filesApi";
import { joinPath, parentPath } from "../lib/listing";
import { toApiFailure } from "../lib/records";
import { Dialog } from "./Dialog";
import { FailureState } from "./Errors";

const inputCls =
  "mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-600 focus:outline-none";
const labelCls = "block text-sm font-medium text-gray-700";
const submitCls =
  "mt-4 rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50";
const cancelCls = "mt-4 rounded border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50";

function FormActions({
  busy,
  label,
  testid,
  onCancel,
}: {
  busy: boolean;
  label: string;
  testid: string;
  onCancel: () => void;
}) {
  return (
    <div className="flex items-center justify-end gap-2">
      <button type="button" onClick={onCancel} className={cancelCls}>
        Cancel
      </button>
      <button type="submit" disabled={busy} data-testid={testid} className={submitCls}>
        {label}
      </button>
    </div>
  );
}

function DialogFailure({
  failure,
  onRetry,
  onClose,
}: {
  failure: ApiFailure;
  onRetry?: () => void;
  onClose: () => void;
}) {
  return (
    <>
      <FailureState failure={failure} onRetry={onRetry} />
      <div className="mt-3 text-right">
        <button type="button" onClick={onClose} className={cancelCls}>
          Close
        </button>
      </div>
    </>
  );
}

function Form({
  onSubmit,
  children,
}: {
  onSubmit: (e: FormEvent) => void;
  children: ReactNode;
}) {
  return (
    <form onSubmit={onSubmit} noValidate>
      {children}
    </form>
  );
}

export function MkdirDialog({
  vdirId,
  dir,
  onClose,
  onDone,
}: {
  vdirId: string;
  dir: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<ApiFailure | null>(null);

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setFailure(null);
    try {
      await mkdir(vdirId, joinPath(dir, name.trim()));
      onDone();
    } catch (err) {
      setFailure(toApiFailure(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog title="New folder" onClose={onClose}>
      {failure ? (
        <DialogFailure
          failure={failure}
          onRetry={failure.kind === "retryable" ? () => void submit() : undefined}
          onClose={onClose}
        />
      ) : (
        <Form onSubmit={(e) => void submit(e)}>
          <label htmlFor="mkdir-name" className={labelCls}>
            Folder name
          </label>
          <input
            id="mkdir-name"
            data-testid="mkdir-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={inputCls}
            autoFocus
          />
          <FormActions busy={busy || !name.trim()} label="Create" testid="mkdir-submit" onCancel={onClose} />
        </Form>
      )}
    </Dialog>
  );
}

export function RenameDialog({
  vdirId,
  entry,
  path,
  onClose,
  onDone,
}: {
  vdirId: string;
  entry: LsEntry;
  path: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [name, setName] = useState(entry.name);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<ApiFailure | null>(null);

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setFailure(null);
    try {
      await mv(vdirId, path, joinPath(parentPath(path), name.trim()));
      onDone();
    } catch (err) {
      setFailure(toApiFailure(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog title={`Rename ${entry.name}`} onClose={onClose}>
      {failure ? (
        <DialogFailure
          failure={failure}
          onRetry={failure.kind === "retryable" ? () => void submit() : undefined}
          onClose={onClose}
        />
      ) : (
        <Form onSubmit={(e) => void submit(e)}>
          <label htmlFor="rename-name" className={labelCls}>
            New name
          </label>
          <input
            id="rename-name"
            data-testid="rename-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={inputCls}
            autoFocus
          />
          <FormActions busy={busy || !name.trim()} label="Rename" testid="rename-submit" onCancel={onClose} />
        </Form>
      )}
    </Dialog>
  );
}

export function MoveDialog({
  vdirId,
  entry,
  path,
  onClose,
  onDone,
}: {
  vdirId: string;
  entry: LsEntry;
  path: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [to, setTo] = useState(path);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<ApiFailure | null>(null);

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!to.trim() || to.trim() === path) return;
    setBusy(true);
    setFailure(null);
    try {
      await mv(vdirId, path, to.trim());
      onDone();
    } catch (err) {
      setFailure(toApiFailure(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog title={`Move ${entry.name}`} onClose={onClose}>
      {failure ? (
        <DialogFailure
          failure={failure}
          onRetry={failure.kind === "retryable" ? () => void submit() : undefined}
          onClose={onClose}
        />
      ) : (
        <Form onSubmit={(e) => void submit(e)}>
          <label htmlFor="move-to" className={labelCls}>
            Destination path
          </label>
          <input
            id="move-to"
            data-testid="move-to"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className={inputCls}
            autoFocus
          />
          <FormActions
            busy={busy || !to.trim() || to.trim() === path}
            label="Move"
            testid="move-submit"
            onCancel={onClose}
          />
        </Form>
      )}
    </Dialog>
  );
}

export function DeleteDialog({
  vdirId,
  entry,
  path,
  onClose,
  onDone,
}: {
  vdirId: string;
  entry: LsEntry;
  path: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<ApiFailure | null>(null);

  const submit = async () => {
    setBusy(true);
    setFailure(null);
    try {
      await rm(vdirId, path);
      onDone();
    } catch (err) {
      setFailure(toApiFailure(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog title={`Delete ${entry.name}`} onClose={onClose}>
      {failure ? (
        <DialogFailure
          failure={failure}
          onRetry={failure.kind === "retryable" ? () => void submit() : undefined}
          onClose={onClose}
        />
      ) : (
        <div>
          <p className="text-sm text-gray-700">
            Delete <span className="font-medium">{entry.name}</span>
            {entry.dir ? " and everything inside it" : ""}? This cannot be undone.
          </p>
          <div className="flex items-center justify-end gap-2">
            <button type="button" onClick={onClose} className={cancelCls}>
              Cancel
            </button>
            <button
              type="button"
              disabled={busy}
              data-testid="delete-confirm"
              onClick={() => void submit()}
              className="mt-4 rounded bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
            >
              Delete
            </button>
          </div>
        </div>
      )}
    </Dialog>
  );
}
