import * as React from "react";

import { cn } from "@/lib/utils";

import { buttonVariants, type ButtonVariantProps } from "./button";

export interface IconButtonProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "aria-label">,
    Omit<ButtonVariantProps, "block"> {
  /** Required accessible name: icons never carry meaning alone. */
  label: string;
}

const SQUARE = { sm: "w-9 px-0", md: "w-11 px-0", lg: "w-12 px-0" } as const;

export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, className, variant = "ghost", size = "md", type = "button", ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={label}
      className={cn(buttonVariants({ variant, size }), SQUARE[size ?? "md"], className)}
      {...props}
    />
  );
});
