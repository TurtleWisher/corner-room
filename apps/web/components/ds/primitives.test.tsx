import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { RoomCube, cubeFrontLines } from "@/components/brand/room-cube";

import { monogram } from "./avatar";
import { Button } from "./button";
import { DateBlock, DateTime } from "./date-time";
import { Field } from "./field";
import { Input } from "./input";
import { Money } from "./money";
import { StatusChip } from "./status-chip";
import { UnavailableValue } from "./states";

const html = (el: React.ReactElement) => renderToStaticMarkup(el);

describe("Money", () => {
  it("renders the taka sign from the Bengali face and the ISO code for screen readers", () => {
    const out = html(<Money value={{ amount_minor: 150000, currency_code: "BDT" }} />);
    expect(out).toContain('<span class="cr-taka">৳</span>1,500');
    expect(out).toContain('<span class="sr-only">BDT 1,500</span>');
  });
  it("says Not available instead of 0", () => {
    const out = html(<Money value={{ amount_minor: null, currency_code: "BDT" }} />);
    expect(out).toContain("Not available");
    expect(out.replace(/<[^>]+>/g, "")).not.toMatch(/\d/);
  });
});

describe("StatusChip", () => {
  it("shows unknown API values humanised, with a label not just a colour", () => {
    expect(html(<StatusChip value="AWAITING_SECOND_APPROVAL" />)).toContain("Awaiting second approval");
  });
});

describe("Field", () => {
  it("wires label, hint and error to the control", () => {
    const out = html(
      <Field id="email" label="Email" hint="We never share it" error="Enter an email" required>
        {(p) => <Input {...p} />}
      </Field>,
    );
    expect(out).toContain('for="email"');
    expect(out).toContain('aria-describedby="email-hint email-error"');
    expect(out).toContain('aria-invalid="true"');
    expect(out).toContain('role="alert"');
    expect(out).toContain("(required)");
  });
});

describe("Button", () => {
  it("defaults to type=button and exposes busy state", () => {
    const out = html(<Button busy>Pay</Button>);
    expect(out).toContain('type="button"');
    expect(out).toContain('aria-busy="true"');
    expect(out).toContain("disabled");
  });
});

describe("DateTime", () => {
  it("renders in the event zone inside <time>", () => {
    const out = html(<DateTime value="2025-10-17T14:00:00Z" timeZone="Asia/Dhaka" showZone />);
    expect(out).toContain('dateTime="2025-10-17T14:00:00.000Z"');
    expect(out).toContain("8:00 PM");
    expect(out).toContain("Dhaka time");
  });
  it("labels a UTC fallback instead of shifting silently", () => {
    expect(html(<DateTime value="2025-10-17T14:00:00Z" format="time" />)).toContain("UTC");
  });
  it("date block uses condensed numerals", () => {
    expect(html(<DateBlock value="2025-10-17T14:00:00Z" timeZone="Asia/Dhaka" />)).toContain('class="cr-num');
  });
});

describe("RoomCube", () => {
  it("builds the cube from the title and the secondary value only", () => {
    expect(cubeFrontLines("Low Tide", "Sessions")).toEqual(["LOW", "TIDE"]);
    const out = html(<RoomCube front="Low Tide" side="Sessions" />);
    expect(out).toContain('aria-label="Low Tide, Sessions"');
    expect(out).not.toContain("<text");
  });
  it("falls back to fitted text for Bangla words until a Bangla glyph set exists", () => {
    expect(html(<RoomCube front="শহর" side="ঢাকা" />)).toContain(">শহর<");
  });
  it("can be decorative when the title is visible beside it", () => {
    expect(html(<RoomCube front="Low Tide" side="Sessions" label="" />)).toContain('aria-hidden="true"');
  });
});

describe("helpers", () => {
  it("monogram", () => {
    expect(monogram("Kaal Bela")).toBe("KB");
    expect(monogram("Dhulo")).toBe("DH");
  });
  it("UnavailableValue carries a reason for assistive tech", () => {
    expect(html(<UnavailableValue reason="Not reported by analytics" />)).toContain("Not reported by analytics");
  });
});
