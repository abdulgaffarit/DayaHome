import * as React from "react";
import { cn } from "@/lib/cn";

/**
 * Form primitives.
 *
 * Every control is wired to its label and, when invalid, to its error message
 * via `aria-describedby` + `aria-invalid`, so screen readers announce the
 * problem rather than leaving the user to guess at a red border.
 */

const controlBase =
  "w-full rounded-[--radius-control] border bg-white px-4 text-ink-900 " +
  "placeholder:text-ink-400 transition-colors " +
  "focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand-700 " +
  "disabled:bg-ink-50 disabled:text-ink-400";

export function Label({
  className,
  required,
  children,
  ...props
}: React.LabelHTMLAttributes<HTMLLabelElement> & { required?: boolean }) {
  return (
    <label className={cn("block text-sm font-medium text-ink-700", className)} {...props}>
      {children}
      {required ? (
        <span className="text-danger-500" aria-hidden="true">
          {" *"}
        </span>
      ) : null}
    </label>
  );
}

export function FieldError({ id, children }: { id?: string; children?: React.ReactNode }) {
  if (!children) return null;
  return (
    <p id={id} role="alert" className="mt-1.5 text-sm text-danger-700">
      {children}
    </p>
  );
}

export function Hint({ id, children }: { id?: string; children?: React.ReactNode }) {
  if (!children) return null;
  return (
    <p id={id} className="mt-1.5 text-sm text-ink-500">
      {children}
    </p>
  );
}

export interface FieldProps {
  label?: React.ReactNode;
  htmlFor?: string;
  required?: boolean;
  error?: string;
  hint?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}

export function Field({ label, htmlFor, required, error, hint, className, children }: FieldProps) {
  return (
    <div className={cn("w-full", className)}>
      {label ? (
        <Label htmlFor={htmlFor} required={required} className="mb-1.5">
          {label}
        </Label>
      ) : null}
      {children}
      <FieldError id={htmlFor ? `${htmlFor}-error` : undefined}>{error}</FieldError>
      {!error ? <Hint id={htmlFor ? `${htmlFor}-hint` : undefined}>{hint}</Hint> : null}
    </div>
  );
}

export const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }
>(function Input({ className, invalid, ...props }, ref) {
  return (
    <input
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cn(
        controlBase,
        "h-11",
        invalid ? "border-danger-500" : "border-ink-200 hover:border-ink-300",
        className,
      )}
      {...props}
    />
  );
});

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }
>(function Textarea({ className, invalid, ...props }, ref) {
  return (
    <textarea
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cn(
        controlBase,
        "min-h-32 py-3 leading-relaxed",
        invalid ? "border-danger-500" : "border-ink-200 hover:border-ink-300",
        className,
      )}
      {...props}
    />
  );
});

export const Select = React.forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean }
>(function Select({ className, invalid, children, ...props }, ref) {
  return (
    <select
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cn(
        controlBase,
        "h-11 appearance-none pr-10",
        // Chevron drawn as a background image so no extra DOM node is needed.
        "bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A//www.w3.org/2000/svg%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22none%22%20stroke%3D%22%236b7674%22%20stroke-width%3D%222%22%20stroke-linecap%3D%22round%22%3E%3Cpath%20d%3D%22m6%209%206%206%206-6%22/%3E%3C/svg%3E')] bg-[length:1.15rem] bg-[right_0.75rem_center] bg-no-repeat",
        invalid ? "border-danger-500" : "border-ink-200 hover:border-ink-300",
        className,
      )}
      {...props}
    >
      {children}
    </select>
  );
});

export function Checkbox({
  className,
  label,
  id,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { label: React.ReactNode }) {
  return (
    <label
      htmlFor={id}
      className={cn(
        "flex cursor-pointer items-start gap-3 text-[0.95rem] text-ink-700",
        className,
      )}
    >
      <input
        id={id}
        type="checkbox"
        className="mt-1 h-5 w-5 shrink-0 rounded border-ink-300 text-brand-700 accent-brand-700"
        {...props}
      />
      <span>{label}</span>
    </label>
  );
}
