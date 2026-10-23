"use client";

import { cloneElement, isValidElement, useId, type InputHTMLAttributes, type ReactElement, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { inputClass } from "./Input";

export type FieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, "children"> & {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  /** A custom control (<Select>, <Input>, …). It gets the id and aria wiring automatically. */
  children?: ReactNode;
};

type ControlProps = { id?: string; "aria-invalid"?: boolean; "aria-describedby"?: string };

export function Field({ label, hint, error, id, className, children, ...input }: FieldProps) {
  const autoId = useId();
  const control = isValidElement(children) ? (children as ReactElement<ControlProps>) : null;
  // The label must point at the control's own id if it brought one.
  const fieldId = control?.props.id ?? id ?? autoId;
  const noteId = `${fieldId}-note`;
  const note = error ?? hint;

  return (
    <div className={cn("space-y-2", className)}>
      <label htmlFor={fieldId} className="block text-lg font-medium text-ink">
        {label}
      </label>
      {control ? (
        cloneElement(control, {
          id: fieldId,
          "aria-invalid": error ? true : control.props["aria-invalid"],
          "aria-describedby": note ? noteId : control.props["aria-describedby"],
        })
      ) : children ? (
        children
      ) : (
        <input
          id={fieldId}
          aria-invalid={error ? true : undefined}
          aria-describedby={note ? noteId : undefined}
          className={inputClass}
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
