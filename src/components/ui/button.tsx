import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn";

const buttonStyles = cva(
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
        // 36px is comfortable with a mouse but under the 44px touch minimum, so
        // devices whose primary input is a finger get the taller box. Scoped to
        // `pointer-coarse` rather than a width breakpoint so desktop layouts —
        // admin tables especially — are unchanged at every size.
        sm: "h-9 pointer-coarse:h-11 px-3 text-sm",
        md: "h-11 px-5 text-[0.95rem]",
        lg: "h-13 px-7 text-base",
        icon: "h-11 w-11",
      },
      full: { true: "w-full", false: "" },
    },
    defaultVariants: { variant: "primary", size: "md", full: false },
  },
);

/**
 * Button classes for elements that are not `<Button>` — most often a `<Link>`.
 *
 * Goes through `cn` (tailwind-merge) rather than returning cva's raw output,
 * because cva only concatenates: a caller passing `className: "hidden sm:inline-flex"`
 * kept the base `inline-flex` too, and since Tailwind emits `inline-flex` after
 * `hidden` the element stayed visible. That is how the header's desktop-only
 * buttons rendered at 320px and pushed every page 179px wide.
 */
function buttonVariants(props?: Parameters<typeof buttonStyles>[0]): string {
  return cn(buttonStyles(props));
}

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonStyles> {
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
      className={cn(buttonStyles({ variant, size, full }), className)}
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
