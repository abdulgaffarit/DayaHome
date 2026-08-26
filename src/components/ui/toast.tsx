"use client";

import * as React from "react";
import { AlertTriangle, CheckCircle2, Info, X } from "lucide-react";
import { cn } from "@/lib/cn";

type ToastTone = "success" | "error" | "info";

interface Toast {
  id: number;
  tone: ToastTone;
  message: string;
}

const ToastContext = React.createContext<{
  show: (message: string, tone?: ToastTone) => void;
} | null>(null);

/**
 * Toasts live in an `aria-live="polite"` region so they are announced without
 * stealing focus from whatever the user is doing.
 */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<Toast[]>([]);
  const nextId = React.useRef(0);

  const show = React.useCallback((message: string, tone: ToastTone = "info") => {
    const id = nextId.current++;
    setToasts((current) => [...current, { id, tone, message }]);
    setTimeout(() => {
      setToasts((current) => current.filter((t) => t.id !== id));
    }, 5000);
  }, []);

  const dismiss = React.useCallback((id: number) => {
    setToasts((current) => current.filter((t) => t.id !== id));
  }, []);

  const value = React.useMemo(() => ({ show }), [show]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        aria-atomic="false"
        className="pointer-events-none fixed inset-x-0 bottom-20 z-50 flex flex-col items-center gap-2 px-4 sm:bottom-6"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={cn(
              "pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-[--radius-control] border px-4 py-3 shadow-[--shadow-pop]",
              toast.tone === "success" && "border-brand-200 bg-white text-brand-900",
              toast.tone === "error" && "border-danger-500/30 bg-white text-danger-700",
              toast.tone === "info" && "border-ink-200 bg-white text-ink-800",
            )}
          >
            <ToastIcon tone={toast.tone} />
            <p className="flex-1 text-sm leading-relaxed">{toast.message}</p>
            <button
              type="button"
              onClick={() => dismiss(toast.id)}
              aria-label="বন্ধ করুন"
              className="-m-1 rounded-full p-1 text-ink-400 hover:text-ink-700"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastIcon({ tone }: { tone: ToastTone }) {
  const className = "mt-0.5 h-5 w-5 shrink-0";
  if (tone === "success") return <CheckCircle2 className={cn(className, "text-brand-700")} aria-hidden="true" />;
  if (tone === "error") return <AlertTriangle className={cn(className, "text-danger-500")} aria-hidden="true" />;
  return <Info className={cn(className, "text-info-500")} aria-hidden="true" />;
}

export function useToast() {
  const context = React.useContext(ToastContext);
  if (!context) {
    // A no-op fallback keeps components usable in isolation (tests, storybooks)
    // without forcing every tree to include the provider.
    return { show: () => {} };
  }
  return context;
}
