// iOS overlay primitives (design D5): a bottom `Sheet` (grabber,
// focus-trapped, Escape/backdrop dismiss, focus return) and a centered
// `Alert` for destructive confirmations. Both render through a portal
// so they sit above the tab bar.

import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

function useOverlayBehavior(onClose: () => void) {
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    panel.current?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key !== "Tab" || !panel.current) return;
      const focusable = panel.current.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      previouslyFocused?.focus?.();
    };
  }, [onClose]);

  return panel;
}

export function Sheet({
  label,
  onClose,
  children,
  testid = "sheet",
}: {
  label: string;
  onClose: () => void;
  children: ReactNode;
  testid?: string;
}) {
  const panel = useOverlayBehavior(onClose);

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex flex-col justify-end bg-black/40 backdrop-blur-sm"
      data-testid="sheet-backdrop"
      onClick={onClose}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        data-testid={testid}
        className="max-h-[90dvh] overflow-auto rounded-t-[32px] bg-ios-bg pb-safe shadow-2xl outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mt-2 mb-1 h-1.5 w-9 rounded-full bg-ios-secondary/20" aria-hidden="true" />
        {children}
      </div>
    </div>,
    document.body,
  );
}

export function Alert({
  title,
  message,
  children,
  cancelLabel = "Cancel",
  confirmLabel,
  destructive = false,
  busy = false,
  onCancel,
  onConfirm,
  confirmTestid = "alert-confirm",
}: {
  title: string;
  message?: ReactNode;
  children?: ReactNode;
  cancelLabel?: string;
  confirmLabel: string;
  destructive?: boolean;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  confirmTestid?: string;
}) {
  const panel = useOverlayBehavior(onCancel);

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6 backdrop-blur-sm"
      data-testid="alert-backdrop"
      onClick={onCancel}
    >
      <div
        ref={panel}
        role="alertdialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        data-testid="alert"
        className="w-72 overflow-hidden rounded-[22px] bg-ios-card/95 text-center shadow-2xl outline-none backdrop-blur-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-5 pb-4">
          <h2 className="mb-1 text-base font-bold text-ios-label">{title}</h2>
          {message && <div className="text-xs leading-normal text-ios-secondary/80">{message}</div>}
          {children}
        </div>
        <div className="flex divide-x divide-ios-separator border-t border-ios-separator">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 py-3 text-base text-ios-blue hover:bg-black/5"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            disabled={busy}
            data-testid={confirmTestid}
            onClick={onConfirm}
            className={`flex-1 py-3 text-base font-bold hover:bg-black/5 disabled:opacity-50 ${
              destructive ? "text-ios-red" : "text-ios-blue"
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
