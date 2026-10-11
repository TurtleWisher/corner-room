"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

import { IconButton } from "./icon-button";

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  children?: React.ReactNode;
  footer?: React.ReactNode;
  /** "center" is a dialog; "right" and "bottom" are drawers. */
  placement?: "center" | "right" | "bottom";
  className?: string;
}

/**
 * Native <dialog> with showModal(): focus trap, Escape, inert background and top layer come
 * from the browser. Focus returns to the opener on close.
 */
export function Dialog({ open, onClose, title, description, children, footer, placement = "center", className }: DialogProps) {
  const ref = React.useRef<HTMLDialogElement>(null);
  const opener = React.useRef<Element | null>(null);
  const titleId = React.useId();
  const descId = React.useId();

  React.useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      opener.current = document.activeElement;
      d.showModal();
    } else if (!open && d.open) {
      d.close();
    }
  }, [open]);

  React.useEffect(() => {
    const d = ref.current;
    if (!d) return;
    const handleClose = () => {
      onClose();
      if (opener.current instanceof HTMLElement) opener.current.focus();
    };
    d.addEventListener("close", handleClose);
    return () => d.removeEventListener("close", handleClose);
  }, [onClose]);

  const position = {
    center: "m-auto w-[min(32rem,calc(100vw-2rem))]",
    right: "my-0 ml-auto mr-0 h-dvh max-h-dvh w-[min(28rem,100vw)]",
    bottom: "mx-0 mb-0 mt-auto w-screen max-w-none",
  }[placement];

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={description ? descId : undefined}
      onClick={(e) => {
        if (e.target === ref.current) ref.current?.close();
      }}
      className={cn(
        "cr-scope cr-cut border-0 bg-transparent p-0 text-fg [--cut-fill:var(--cr-surface-raised)] [--cut-border:var(--cr-line-strong)]",
        "backdrop:bg-black/60 backdrop:backdrop-blur-[2px]",
        position,
        className,
      )}
    >
      <div className="flex max-h-[inherit] flex-col">
        <div className="flex items-start justify-between gap-4 p-5 pb-3">
          <div>
            <h2 id={titleId} className="font-ui text-lg font-bold text-fg">
              {title}
            </h2>
            {description ? (
              <p id={descId} className="mt-1 text-sm text-fg-muted">
                {description}
              </p>
            ) : null}
          </div>
          <IconButton label="Close" size="sm" onClick={() => ref.current?.close()}>
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="m4 4 8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.8" />
            </svg>
          </IconButton>
        </div>
        <div className="overflow-y-auto px-5 pb-5 text-sm text-fg">{children}</div>
        {footer ? <div className="flex justify-end gap-2 border-t border-line p-4">{footer}</div> : null}
      </div>
    </dialog>
  );
}

/** Drawer: a Dialog that slides from the right on desktop and the bottom on phones. */
export function Drawer(props: Omit<DialogProps, "placement"> & { side?: "right" | "bottom" }) {
  const { side = "right", ...rest } = props;
  return <Dialog {...rest} placement={side} />;
}
