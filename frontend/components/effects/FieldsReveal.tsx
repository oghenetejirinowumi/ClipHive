import { Children, type ReactNode } from "react";
import { cn, cssVars } from "@/lib/cn";

/** Staggers its direct children in on mount — used for auth form fields. Pure CSS. */
export function FieldsReveal({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("space-y-4", className)}>
      {Children.toArray(children).map((child, i) => (
        <div key={i} className="fx-rise" style={cssVars({ "--i": i })}>
          {child}
        </div>
      ))}
    </div>
  );
}
