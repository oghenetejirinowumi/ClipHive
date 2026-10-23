"use client";

import { cloneElement, isValidElement, useId, type InputHTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/cn";

export type FieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, "children"> & {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  children?: ReactNode;
};

export function Field({ label, hint, error, id, className, children, ...input }: FieldProps) {
  const autoId = useId();
  const fieldId = id ?? autoId;
  const noteId = `${fieldId}-note`;
  const note = error ?? hint;

  return (
    <div className={cn("space-y-2", className)}>
      <label htmlFor={fieldId} className="block text-lg font-medium text-ink">
        {label}
      </label>
      {children ? (
        isValidElement(children) ? (
          cloneElement(children as React.ReactElement<{ id?: string; "aria-invalid"?: boolean; "aria-describedby"?: string }>, {
            id: (children.props as { id?: string }).id ?? fieldId,
            "aria-invalid": error ? true : (children.props as { "aria-invalid"?: boolean })["aria-invalid"],
            "aria-describedby": note ? noteId : (children.props as { "aria-describedby"?: string })["aria-describedby"],
          })
        ) : (
          children
        )
      ) : (
        <input
          id={fieldId}
          aria-invalid={error ? true : undefined}
          aria-describedby={note ? noteId : undefined}
          className={cn(
            // ≥ 48px tall; ≥ 1rem text also keeps iOS from zooming in on focus.
            "block h-14 w-full rounded-md border bg-surface px-5 text-lg text-ink transition-[border-color,box-shadow] duration-(--motion-fast) placeholder:text-ink-faint focus:border-brand focus:shadow-ring focus-visible:outline-none",
            error ? "border-danger" : "border-line-strong hover:border-ink-faint",
          )}
          {...input}
        />
      )}
      {note && (
        <p id={noteId} className={cn("text-base", error ? "text-danger" : "text-ink-muted")}>
          {note}
        </p>
      )}
    </div>
  );
}
