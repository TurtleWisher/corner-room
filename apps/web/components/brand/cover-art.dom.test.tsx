// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { CoverArt } from "./cover-art";

afterEach(cleanup);

const cube = <span data-testid="cube">cube</span>;

describe("CoverArt", () => {
  it("shows the official cover once it loads, over the cube", () => {
    const { container } = render(<CoverArt src="http://api/cover.jpg" fallback={cube} alt="Saya Porbe" />);
    const img = screen.getByAltText("Saya Porbe");
    expect(img.className).toContain("opacity-0");
    fireEvent.load(img);
    expect(img.className).toContain("opacity-100");
    expect(container.querySelector(".invisible")).toBeTruthy();
  });

  it("keeps the cube when there is no cover or it fails to load", () => {
    const { rerender } = render(<CoverArt src={null} fallback={cube} />);
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.getByTestId("cube")).toBeTruthy();
    rerender(<CoverArt src="http://api/missing.jpg" fallback={cube} alt="Missing" />);
    fireEvent.error(screen.getByAltText("Missing"));
    expect(screen.queryByAltText("Missing")).toBeNull();
    expect(screen.getByTestId("cube").parentElement?.className).not.toContain("invisible");
  });
});
