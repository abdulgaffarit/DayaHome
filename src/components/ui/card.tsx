import * as React from "react";
import { cn } from "@/lib/cn";

/** The rounded, softly-shadowed surface used everywhere on the site. */
export function Card({
  className,
  interactive,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { interactive?: boolean }) {
  return (
    <div
      className={cn(
        "rounded-[--radius-card] border border-ink-100 bg-white shadow-[--shadow-card]",
        interactive &&
          "transition-shadow duration-200 hover:shadow-[--shadow-card-hover] focus-within:shadow-[--shadow-card-hover]",
        className,
      )}
      {...props}
    />
  );
}

export function CardBody({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("p-5", className)} {...props} />;
}

export function CardHeader({
  title,
  description,
  action,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-start justify-between gap-4 border-b border-ink-100 p-5", className)}>
      <div className="min-w-0">
        <h2 className="text-lg font-semibold text-ink-900">{title}</h2>
        {description ? <p className="mt-1 text-sm text-ink-500">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}
