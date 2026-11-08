// @vitest-environment jsdom
/* Preview Studio waveform with a finger (owner, 2026-11-08, D-TEASER-06): a press near an edge or the
 * play line takes it, the chosen part slides, and a press elsewhere sets where the song plays from. */
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import type { TeaserLimits, TeaserSettings } from "@/features/teasers/api";

import { TeaserWaveform } from "./waveform";

afterEach(cleanup);

beforeAll(() => {
  // jsdom has no PointerEvent; a MouseEvent with the pointer fields is enough here.
  if (typeof window.PointerEvent === "undefined") {
    class FakePointerEvent extends MouseEvent {
      pointerId: number;
      pointerType: string;
      constructor(type: string, init: PointerEventInit = {}) {
        super(type, init);
        this.pointerId = init.pointerId ?? 1;
        this.pointerType = init.pointerType ?? "mouse";
      }
    }
    (window as unknown as { PointerEvent: typeof MouseEvent }).PointerEvent = FakePointerEvent;
  }
});

const limits: TeaserLimits = { min_ms: 5_000, max_ms: 60_000, fade_max_ms: 10_000, gain_min_cdb: -1200, gain_max_cdb: 600 };
const settings: TeaserSettings = { start_ms: 10_000, end_ms: 30_000, fade_in_ms: 0, fade_out_ms: 0, gain_cdb: 0 };

function setup(playheadMs: number | null = null) {
  const onChange = vi.fn();
  const onSeek = vi.fn();
  const view = render(
    <TeaserWaveform
      points={[10, 20, 30]}
      bucketMs={1000}
      masterMs={100_000}
      view={{ fromMs: 0, toMs: 100_000 }}
      settings={settings}
      limits={limits}
      playheadMs={playheadMs}
      onChange={onChange}
      onSeek={onSeek}
    />,
  );
  const frame = view.container.firstElementChild as HTMLElement;
  const box = frame.firstElementChild as HTMLElement;
  // 1000 px wide: 1 px is 100 ms, so the start sits at x 100 and the end at x 300.
  box.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1000, height: 160, right: 1000, bottom: 160, x: 0, y: 0, toJSON: () => ({}) });
  const press = (x: number, pointerType = "touch") => fireEvent.pointerDown(frame, { clientX: x, button: 0, pointerId: 7, pointerType });
  const move = (x: number) => fireEvent.pointerMove(frame, { clientX: x, pointerId: 7, pointerType: "touch" });
  const lift = (x: number) => fireEvent.pointerUp(frame, { clientX: x, pointerId: 7, pointerType: "touch" });
  return { onChange, onSeek, press, move, lift };
}

describe("TeaserWaveform with a finger", () => {
  it("takes the end edge from a finger's width away and drags it", () => {
    const { onChange, press, move, lift } = setup();
    press(280); // 20 px from the end line: in reach for a finger
    move(400);
    // The edge keeps its 20 px from the finger: 120 px further is 12 s later.
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ start_ms: 10_000, end_ms: 42_000 }), false);
    lift(400);
    expect(onChange).toHaveBeenLastCalledWith(expect.anything(), true);
  });

  it("gives a mouse less reach, so the same press slides the chosen part", () => {
    const { onChange, press, move } = setup();
    press(280, "mouse");
    move(300);
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ start_ms: 12_000, end_ms: 32_000 }), false);
  });

  it("drags the play line and plays from where the finger lifts", () => {
    const { onSeek, press, move, lift } = setup(50_000);
    press(510); // the play line is at x 500
    move(700);
    expect(onSeek).not.toHaveBeenCalled();
    lift(700);
    expect(onSeek).toHaveBeenCalledWith(70_000);
  });

  it("sets a new play point when pressed outside the chosen part", () => {
    const { onSeek, onChange, press, lift } = setup();
    press(800);
    lift(800);
    expect(onSeek).toHaveBeenCalledWith(80_000);
    expect(onChange).not.toHaveBeenCalled();
  });
});
