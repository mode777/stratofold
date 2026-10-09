// File-management overlays (web-ui spec, design D5/D6): New Folder and
// Rename as bottom `Sheet`s, Delete as a destructive `Alert`. Each
// reuses FailureState so the deterministic error classes render as the
// established states, with a working retry on 503.

import { useState } from "react";
import { mkdir, mv, rm, type ApiFailure, type LsEntry } from "../lib/filesApi";
import { joinPath, parentPath } from "../lib/listing";
import { toApiFailure } from "../lib/records";
import { Alert, Sheet } from "./Dialog";
import { FailureState } from "./Errors";

function SheetHeader({
  title,
  actionLabel,
  busy,
  disabled,
  onCancel,
  onSubmit,
  testid,
}: {
  title: string;
  actionLabel: string;
  busy: boolean;
  disabled?: boolean;
  onCancel: () => void;
  onSubmit: () => void;
  testid: string;
}) {
  return (
    <div className="flex items-center justify-between px-4 py-2">
      <button type="button" onClick={onCancel} className="text-base text-ios-blue">
        Cancel
      </button>
      <h2 className="text-base font-bold text-ios-label">{title}</h2>
      <button
        type="button"
        disabled={busy || disabled}
        data-testid={testid}
        onClick={onSubmit}
        className="text-base font-bold text-ios-blue disabled:opacity-40"
      >
        {actionLabel}
      </button>
    </div>
  );
}

function Field({
  id,
  value,
  onChange,
  placeholder,
  autoFocus,
  testid,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
  testid: string;
}) {
  return (
    <div className="mx-4 mb-3 rounded-2xl border border-black/5 bg-ios-card p-3 shadow-sm">
      <input
        id={id}
        data-testid={testid}
        value={value}
        autoFocus={autoFocus}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-transparent text-base text-ios-label outline-none"
      />
    </div>
  );
}

export function MkdirSheet({
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

  const submit = async () => {
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
    <Sheet label="New Folder" onClose={onClose}>
      <SheetHeader
        title="New Folder"
        actionLabel="Create"
        busy={busy}
        disabled={!name.trim()}
        onCancel={onClose}
        onSubmit={() => void submit()}
        testid="mkdir-submit"
      />
      {failure ? (
        <div className="pb-6">
          <FailureState
            failure={failure}
            onRetry={failure.kind === "retryable" ? () => void submit() : undefined}
          />
          <div className="text-center">
            <button type="button" onClick={onClose} className="text-base text-ios-blue">
              Close
            </button>
          </div>
        </div>
      ) : (
        <>
          <Field id="mkdir-name" testid="mkdir-name" value={name} onChange={setName} placeholder="Folder name" autoFocus />
          <p className="pb-6 text-center text-xs text-ios-secondary/60">
            Will be created inside {dir || "the vdir root"}
          </p>
        </>
      )}
    </Sheet>
  );
}

export function RenameSheet({
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

  const submit = async () => {
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
    <Sheet label="Rename" onClose={onClose}>
      <SheetHeader
        title="Rename"
        actionLabel="Rename"
        busy={busy}
        disabled={!name.trim()}
        onCancel={onClose}
        onSubmit={() => void submit()}
        testid="rename-submit"
      />
      {failure ? (
        <div className="pb-6">
          <FailureState
            failure={failure}
            onRetry={failure.kind === "retryable" ? () => void submit() : undefined}
          />
          <div className="text-center">
            <button type="button" onClick={onClose} className="text-base text-ios-blue">
              Close
            </button>
          </div>
        </div>
      ) : (
        <>
          <Field id="rename-name" testid="rename-name" value={name} onChange={setName} autoFocus />
          <p className="pb-6 text-center text-xs text-ios-secondary/60">The extension is preserved.</p>
        </>
      )}
    </Sheet>
  );
}

export function DeleteAlert({
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

  if (failure) {
    return (
      <Alert
        title="Delete failed"
        confirmLabel="Close"
        onCancel={onClose}
        onConfirm={onClose}
        confirmTestid="delete-close"
      >
        <FailureState
          failure={failure}
          onRetry={failure.kind === "retryable" ? () => void submit() : undefined}
        />
      </Alert>
    );
  }

  return (
    <Alert
      title={`Delete “${entry.name}”?`}
      message={
        <>
          {entry.dir ? "Everything inside it will be deleted. " : ""}This cannot be undone.
        </>
      }
      confirmLabel="Delete"
      destructive
      busy={busy}
      onCancel={onClose}
      onConfirm={() => void submit()}
      confirmTestid="delete-confirm"
    />
  );
}
