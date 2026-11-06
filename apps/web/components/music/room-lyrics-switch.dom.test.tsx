// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { lyricsSwitch } from "@/lib/room-controls-view";
import { RoomLyricsSwitch } from "./room-lyrics-switch";

afterEach(cleanup);

describe("RoomLyricsSwitch", () => {
  it("is a real switch, on, with its state in words", () => {
    const toggle = vi.fn();
    render(<RoomLyricsSwitch state={lyricsSwitch({ loaded: true, lineCount: 4, on: true })} onToggle={toggle} />);
    const sw = screen.getByRole("switch", { name: /Lyrics/ });
    expect(sw.tagName).toBe("BUTTON");
    expect(sw.getAttribute("aria-checked")).toBe("true");
    expect(sw.textContent).toContain("On");
    expect(sw.className).toContain("cr-focus");
    sw.click();
    expect(toggle).toHaveBeenCalledTimes(1);
  });

  it("takes keyboard focus (a native button, so Enter and Space work), and shows off in words", () => {
    const toggle = vi.fn();
    render(<RoomLyricsSwitch state={lyricsSwitch({ loaded: true, lineCount: 4, on: false })} onToggle={toggle} />);
    const sw = screen.getByRole("switch", { name: /Lyrics/ });
    sw.focus();
    expect(document.activeElement).toBe(sw);
    expect(sw.getAttribute("aria-checked")).toBe("false");
    expect(sw.textContent).toContain("Off");
  });

  it("invites once: the pulse is dropped when its animation ends", () => {
    render(<RoomLyricsSwitch state={lyricsSwitch({ loaded: true, lineCount: 4, on: true })} onToggle={() => {}} />);
    const sw = screen.getByRole("switch", { name: /Lyrics/ });
    expect(sw.hasAttribute("data-invite")).toBe(true);
    const end = new Event("animationend", { bubbles: true });
    Object.defineProperty(end, "animationName", { value: "lr-invite" });
    fireEvent(sw.querySelector(".lr-switch-track")!, end);
    expect(sw.hasAttribute("data-invite")).toBe(false);
  });

  it("never pretends: no lyrics means disabled, off, with the reason read out", () => {
    const toggle = vi.fn();
    render(<RoomLyricsSwitch state={lyricsSwitch({ loaded: true, lineCount: 0, on: true })} onToggle={toggle} />);
    const sw = screen.getByRole("switch", { name: /Lyrics/ }) as HTMLButtonElement;
    expect(sw.disabled).toBe(true);
    expect(sw.getAttribute("aria-checked")).toBe("false");
    expect(sw.hasAttribute("data-invite")).toBe(false);
    const reason = screen.getByText("No lyrics for this song yet");
    expect(sw.getAttribute("aria-describedby")).toBe(reason.id);
    sw.click();
    expect(toggle).not.toHaveBeenCalled();
  });

  it("stays out of the way while the lyrics load", () => {
    const { container } = render(<RoomLyricsSwitch state={lyricsSwitch({ loaded: false, lineCount: 0, on: true })} onToggle={() => {}} />);
    expect(container.innerHTML).toBe("");
  });
});
