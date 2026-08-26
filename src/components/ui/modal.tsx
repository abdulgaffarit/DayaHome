"use client";

import * as React from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/cn";

/**
 * Accessible dialog built on the native `<dialog>` element, which gives focus
 * trapping, Escape-to-close and the top layer for free — considerably more
 * robust than reimplementing them.
 */
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = "md",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children?: React.ReactNode;
  footer?: React.ReactNode;
  size?: "sm" | "md" | "lg";
}) {
  const ref = React.useRef<HTMLDialogElement>(null);
  const titleId = React.useId();
  const descId = React.useId();

  React.useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={description ? descId : undefined}
      // `cancel` fires on Escape; keep React state as the source of truth.
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClose={onClose}
      // Clicking the backdrop hits the <dialog> itself, not its children.
      onClick={(event) => {
        if (event.target === ref.current) onClose();
      }}
      className={cn(
        "m-auto w-[calc(100vw-2rem)] rounded-[--radius-card] border border-ink-100 bg-white p-0 text-ink-800 shadow-[--shadow-pop]",
        "backdrop:bg-ink-900/45 backdrop:backdrop-blur-[2px]",
        size === "sm" && "max-w-sm",
        size === "md" && "max-w-lg",
        size === "lg" && "max-w-2xl",
      )}
    >
      <div className="flex items-start justify-between gap-4 border-b border-ink-100 p-5">
        <div className="min-w-0">
          <h2 id={titleId} className="text-lg font-semibold text-ink-900">
            {title}
          </h2>
          {description ? (
            <p id={descId} className="mt-1 text-sm text-ink-500">
              {description}
            </p>
          ) : null}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="বন্ধ করুন"
          className="-m-1 rounded-full p-1 text-ink-400 transition-colors hover:bg-ink-100 hover:text-ink-700"
        >
          <X className="h-5 w-5" aria-hidden="true" />
        </button>
      </div>
      {children ? <div className="p-5">{children}</div> : null}
      {footer ? (
        <div className="flex flex-wrap justify-end gap-3 border-t border-ink-100 bg-ink-50/60 p-4">
          {footer}
        </div>
      ) : null}
    </dialog>
  );
}
