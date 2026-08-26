import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn";

const buttonVariants = cva(
  // Shared: consistent radius, comfortable tap target (44px at `md`), and a
  // visible focus ring for keyboard users.
  "inline-flex items-center justify-center gap-2 rounded-[--radius-control] font-medium " +
    "transition-colors duration-150 select-none whitespace-nowrap " +
    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-700 " +
    "disabled:pointer-events-none disabled:opacity-55",
  {
    variants: {
      variant: {
        primary: "bg-brand-700 text-white hover:bg-brand-800 active:bg-brand-900 shadow-sm",
        secondary:
          "bg-surface-mint text-brand-900 hover:bg-brand-100 active:bg-brand-200 border border-brand-100",
        outline:
          "border border-ink-200 bg-white text-ink-800 hover:bg-ink-50 active:bg-ink-100",
        ghost: "text-ink-700 hover:bg-ink-100 active:bg-ink-200",
        danger: "bg-danger-500 text-white hover:bg-danger-700 active:bg-danger-700",
        link: "text-brand-700 underline underline-offset-4 hover:text-brand-800 rounded-sm",
      },
      size: {
        sm: "h-9 px-3 text-sm",
        md: "h-11 px-5 text-[0.95rem]",
        lg: "h-13 px-7 text-base",
        icon: "h-11 w-11",
      },
      full: { true: "w-full", false: "" },
    },
    defaultVariants: { variant: "primary", size: "md", full: false },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  /** Shows a spinner and blocks further clicks. */
  loading?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant, size, full, loading, disabled, children, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      className={cn(buttonVariants({ variant, size, full }), className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? <Spinner /> : null}
      {children}
    </button>
  );
});

function Spinner() {
  return (
    <span
      aria-hidden="true"
      className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"
    />
  );
}

export { buttonVariants };
