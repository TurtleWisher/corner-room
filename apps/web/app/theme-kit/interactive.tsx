"use client";

import * as React from "react";

import { Button } from "@/components/ds/button";
import { Dialog, Drawer } from "@/components/ds/dialog";
import { Field } from "@/components/ds/field";
import { IconButton } from "@/components/ds/icon-button";
import { Input } from "@/components/ds/input";
import { Tabs } from "@/components/ds/tabs";
import { ToastProvider, useToast } from "@/components/ds/toast";
import { Tooltip } from "@/components/ds/tooltip";

function Demo() {
  const [dialog, setDialog] = React.useState(false);
  const [drawer, setDrawer] = React.useState(false);
  const toast = useToast();

  return (
    <div className="grid gap-8 lg:grid-cols-2">
      <Tabs
        label="Sample tabs"
        items={[
          { id: "lineup", label: "Line-up", content: <p className="text-sm text-fg-muted">Arrow keys move between tabs. Home and End jump to the ends.</p> },
          { id: "tickets", label: "Tickets", content: <p className="text-sm text-fg-muted">Panels are focusable so keyboard users can reach their content.</p> },
          { id: "venue", label: "Venue", content: <p className="text-sm text-fg-muted">A disabled tab is skipped by the arrow keys.</p> },
          { id: "soon", label: "Later", content: null, disabled: true },
        ]}
      />
      <div className="flex flex-wrap items-start gap-3">
        <Button onClick={() => setDialog(true)}>Open dialog</Button>
        <Button variant="secondary" onClick={() => setDrawer(true)}>
          Open drawer
        </Button>
        <Button variant="ghost" onClick={() => toast({ title: "Saved to your library", tone: "positive" })}>
          Show toast
        </Button>
        <Tooltip content="Supplementary hint. Escape closes it.">
          <IconButton label="More information" variant="secondary">
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" strokeWidth="1.5" />
              <path d="M8 7v4M8 4.6v.8" stroke="currentColor" strokeWidth="1.6" />
            </svg>
          </IconButton>
        </Tooltip>
      </div>

      <Dialog
        open={dialog}
        onClose={() => setDialog(false)}
        title="Sample dialog"
        description="Native dialog: focus is trapped, Escape closes, focus returns to the opener."
        footer={
          <>
            <Button variant="ghost" onClick={() => setDialog(false)}>
              Cancel
            </Button>
            <Button onClick={() => setDialog(false)}>Confirm</Button>
          </>
        }
      >
        <Field label="Name on the ticket" hint="As it appears on your ID">
          {(p) => <Input {...p} autoComplete="name" />}
        </Field>
      </Dialog>

      <Drawer open={drawer} onClose={() => setDrawer(false)} title="Sample drawer" description="Same behaviour as the dialog, docked to the side.">
        <p className="text-fg-muted">Use for filters, carts and detail panels.</p>
      </Drawer>
    </div>
  );
}

export function InteractiveDemo() {
  return (
    <ToastProvider>
      <Demo />
    </ToastProvider>
  );
}
