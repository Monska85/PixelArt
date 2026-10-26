// SPDX-License-Identifier: GPL-3.0-or-later
// Based on shadcn/ui (MIT): see THIRD_PARTY_NOTICES.txt of the web app.

import { cva, type VariantProps } from "class-variance-authority";
import { AlertTriangle, CheckCircle2, Info, XCircle } from "lucide-react";
import type { ComponentProps } from "react";
import { cn } from "./cn";

const alertVariants = cva("relative flex w-full gap-3 rounded-lg border p-4 text-sm", {
  variants: {
    variant: {
      info: "border-info/40 bg-info-soft text-foreground [&>svg]:text-info",
      success: "border-success/40 bg-success-soft text-foreground [&>svg]:text-success",
      warning: "border-warning/40 bg-warning-soft text-foreground [&>svg]:text-warning",
      destructive: "border-destructive/40 bg-destructive-soft text-foreground [&>svg]:text-destructive",
    },
  },
  defaultVariants: { variant: "info" },
});

const ICONS = { info: Info, success: CheckCircle2, warning: AlertTriangle, destructive: XCircle } as const;

/** An icon, a title and a text, never colored text on a colored background. Errors use `role="alert"`. */
export function Alert({
  className,
  variant = "info",
  children,
  ...props
}: ComponentProps<"div"> & VariantProps<typeof alertVariants>) {
  const Icon = ICONS[variant ?? "info"];
  return (
    <div
      role={variant === "destructive" ? "alert" : "status"}
      className={cn(alertVariants({ variant }), className)}
      {...props}
    >
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <div className="flex min-w-0 flex-1 flex-col gap-1">{children}</div>
    </div>
  );
}

export function AlertTitle({ className, ...props }: ComponentProps<"p">) {
  return <p className={cn("font-medium leading-5", className)} {...props} />;
}

export function AlertDescription({ className, ...props }: ComponentProps<"div">) {
  return (
    <div className={cn("min-w-0 break-words text-muted-foreground [&_p]:leading-relaxed", className)} {...props} />
  );
}
