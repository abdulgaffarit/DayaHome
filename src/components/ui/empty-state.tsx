import * as React from "react";
import { cn } from "@/lib/cn";

/**
 * Empty states are written to tell the user what to do next, not just that
 * there is nothing here.
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded-[--radius-card] border border-dashed border-ink-200 bg-ink-50/60 px-6 py-14 text-center",
        className,
      )}
    >
      {icon ? (
        <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-surface-mint text-brand-700">
          {icon}
        </div>
      ) : null}
      <h3 className="text-lg font-semibold text-ink-900">{title}</h3>
      {description ? <p className="mt-2 max-w-md text-ink-500">{description}</p> : null}
      {action ? <div className="mt-6">{action}</div> : null}
    </div>
  );
}
