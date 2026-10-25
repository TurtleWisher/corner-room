// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ComingSoon } from "./coming-soon";

afterEach(cleanup);

describe("ComingSoon (DOM)", () => {
  it("names what is coming as a heading, with the equaliser hidden from screen readers", () => {
    const { container } = render(<ComingSoon as="h3" eyebrow="Events" title="Events coming soon" body="The first shows will be announced here." />);
    expect(screen.getByRole("heading", { level: 3, name: "Events coming soon" })).toBeTruthy();
    expect(screen.getByText("The first shows will be announced here.")).toBeTruthy();
    const eq = container.querySelector(".cr-soon-eq");
    expect(eq?.getAttribute("aria-hidden")).toBe("true");
    expect(eq?.children).toHaveLength(7);
  });
});
