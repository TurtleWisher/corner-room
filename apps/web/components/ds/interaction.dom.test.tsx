// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import { Field } from "./field";
import { Input } from "./input";
import { Tabs } from "./tabs";
import { ToastProvider, useToast } from "./toast";
import { Tooltip } from "./tooltip";

afterEach(cleanup);

describe("Tabs (DOM)", () => {
  const items = [
    { id: "a", label: "Line-up", content: <p>Panel A</p> },
    { id: "b", label: "Tickets", content: <p>Panel B</p> },
    { id: "c", label: "Later", content: <p>Panel C</p>, disabled: true },
  ];

  it("moves with arrow keys, skips disabled tabs and wraps", async () => {
    const user = userEvent.setup();
    render(<Tabs label="Sample" items={items} />);
    await user.click(screen.getByRole("tab", { name: "Line-up" }));
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "Tickets" })).toHaveProperty("ariaSelected", "true");
    expect(screen.getByText("Panel B")).toBeTruthy();
    await user.keyboard("{ArrowRight}");
    expect(document.activeElement?.textContent).toBe("Line-up");
  });
});

describe("Field (DOM)", () => {
  it("labels the control and announces the error", () => {
    render(<Field label="Email" error="Enter an email">{(p) => <Input {...p} />}</Field>);
    const input = screen.getByLabelText("Email");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByRole("alert").textContent).toContain("Enter an email");
  });
});

function ToastButton() {
  const toast = useToast();
  return (
    <button type="button" onClick={() => toast({ title: "Saved to your library", tone: "positive" })}>
      Save
    </button>
  );
}

describe("Toast (DOM)", () => {
  it("announces through a polite live region", async () => {
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <ToastButton />
      </ToastProvider>,
    );
    await user.click(screen.getByRole("button", { name: "Save" }));
    const region = screen.getByRole("status");
    expect(region.getAttribute("aria-live")).toBe("polite");
    expect(region.textContent).toContain("Saved to your library");
  });
});

describe("Tooltip (DOM)", () => {
  it("describes its trigger and closes on Escape", async () => {
    const user = userEvent.setup();
    render(
      <Tooltip content="More detail">
        <button type="button">Info</button>
      </Tooltip>,
    );
    const trigger = screen.getByRole("button", { name: "Info" });
    await user.tab();
    expect(document.activeElement).toBe(trigger);
    const tip = screen.getByRole("tooltip", { hidden: true });
    expect(trigger.getAttribute("aria-describedby")).toBe(tip.id);
    expect(tip.className).toContain("opacity-100");
    await user.keyboard("{Escape}");
    expect(tip.className).toContain("opacity-0");
  });
});
