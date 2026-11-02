import { describe, expect, it } from "vitest";

import {
  PRESALE_PROMISE,
  parsePaidOn,
  parsePresaleList,
  preorderLabel,
  preorderNote,
  presaleCountdown,
  presaleTotal,
  splitLine,
  studioPresaleStage,
} from "./presale-view";

describe("pre-sale list", () => {
  it("reads a Notion CSV export in any column order and ignores extra columns", () => {
    const csv = [
      "Name,Phone,Email,Address,Amount,Date",
      '"Rahman, Nadia",01711111111,Nadia@Example.com ,"House 1, Dhaka",250,2026-09-01',
      "Karim,01822222222,karim@example.com,Chattogram,\"1,200\",1/9/2026",
    ].join("\n");
    const { rows, problems } = parsePresaleList(csv);
    expect(problems).toEqual([]);
    expect(rows).toEqual([
      { email: "nadia@example.com", buyer_name: "Rahman, Nadia", amount_minor: 25000, paid_on: "2026-09-01", phone: "01711111111", address: "House 1, Dhaka" },
      { email: "karim@example.com", buyer_name: "Karim", amount_minor: 120000, paid_on: "2026-09-01", phone: "01822222222", address: "Chattogram" },
    ]);
    expect(presaleTotal(rows)).toBe(145000);
  });

  it("reads rows copied straight from a Notion table (tabs)", () => {
    const { rows } = parsePresaleList("Email\tCustomer\tPaid\nmina@example.com\tMina\t৳300.50");
    expect(rows).toEqual([{ email: "mina@example.com", buyer_name: "Mina", amount_minor: 30050, paid_on: null, phone: null, address: null }]);
  });

  it("names every line it can't use, and keeps the good ones", () => {
    const { rows, problems } = parsePresaleList(
      ["email,amount,date", "not-an-email,100,", "ok@example.com,abc,", "ok@example.com,100,someday", "ok@example.com,100,"].join("\n"),
    );
    expect(rows.map((r) => r.email)).toEqual(["ok@example.com"]);
    expect(problems.map((p) => p.line)).toEqual([2, 3, 4, 5]);
    expect(problems[2].message).toContain("left empty");
  });

  it("keeps a ৳0 gift as a row (owner, 2026-10-25)", () => {
    const { rows, problems } = parsePresaleList("Email,Amount\ngift@example.com,0");
    expect(problems).toEqual([]);
    expect(rows).toEqual([{ email: "gift@example.com", buyer_name: null, amount_minor: 0, paid_on: null, phone: null, address: null }]);
  });

  it("doesn't mistake a 'Paid on' date column for the amount", () => {
    const { rows } = parsePresaleList("Paid on,Email,Amount\n2026-09-02,ab@example.com,500");
    expect(rows).toEqual([{ email: "ab@example.com", buyer_name: null, amount_minor: 50000, paid_on: "2026-09-02", phone: null, address: null }]);
  });

  it("asks for a header with Email and Amount", () => {
    expect(parsePresaleList("a@example.com,100\nb@example.com,100").problems[0].message).toContain("Email and Amount");
    expect(parsePresaleList("").problems[0].line).toBe(1);
  });

  it("splits quoted CSV cells and reads dates day-first", () => {
    expect(splitLine('a,"b, c",""" d"""')).toEqual(["a", "b, c", '" d"']);
    expect(parsePaidOn("31/12/2026")).toBe("2026-12-31");
    expect(parsePaidOn("31/02/2026")).toBeNull();
    expect(parsePaidOn("")).toBeNull();
  });
});

describe("pre-sale contact details (owner, 2026-10-27)", () => {
  it("reads Notion's Phone and Place columns", () => {
    const { rows } = parsePresaleList('Customer Name,Email,Payment Amount,Phone,Purchase Date,Place\nSabuj,s@example.com,100,01303-290669,10/10/2025,"Flat 3D,  Dhanmondi"');
    expect(rows[0]).toMatchObject({ phone: "01303-290669", address: "Flat 3D, Dhanmondi", paid_on: "2025-10-10" });
  });
});

const NOW = new Date("2026-10-28T12:00:00Z");

describe("pre-orders on Corner Room (D-PRESALE-02)", () => {
  it("counts down to release day in words", () => {
    expect(presaleCountdown("2026-10-31T12:00:00Z", NOW)).toBe("Out in 3 days");
    expect(presaleCountdown("2026-10-29T13:00:00Z", NOW)).toBe("Out in 1 day");
    expect(presaleCountdown("2026-10-28T17:30:00Z", NOW)).toBe("Out in 5 hours");
    expect(presaleCountdown("2026-10-28T12:20:00Z", NOW)).toBe("Out within the hour");
    expect(presaleCountdown("2026-10-28T11:00:00Z", NOW)).toBe("Out now");
    expect(presaleCountdown("not a date", NOW)).toBe("Out now");
  });

  it("names the pre-order", () => {
    expect(preorderLabel("SINGLE")).toBe("Pre-book the single");
    expect(preorderLabel("EP")).toBe("Pre-book the EP");
    expect(preorderLabel("ALBUM")).toBe("Pre-book the album");
    expect(preorderLabel(null)).toBe("Pre-book the release");
  });

  it("states the pre-order promise from the decided policy", () => {
    expect(PRESALE_PROMISE.unlock).toMatch(/unlocks for you on release day/);
    expect(PRESALE_PROMISE.dateChange).toMatch(/stays in place.*refund/);
    expect(PRESALE_PROMISE.cancelled).toMatch(/full refund/);
  });

  it("reads where an early pre-sale stands in Studio", () => {
    expect(studioPresaleStage(null, "IDEA")).toBe("none");
    expect(studioPresaleStage({ can_request: true, price: null }, "IDEA")).toBe("price_needed");
    expect(studioPresaleStage({ can_request: true, price: { status: "PROPOSED" } }, "IDEA")).toBe("ready_to_send");
    expect(studioPresaleStage({ can_request: true, price: { status: "COUNTERED" } }, "IDEA")).toBe("price_needed");
    expect(studioPresaleStage({ status: "REQUESTED" }, "IDEA")).toBe("waiting");
    expect(studioPresaleStage({ status: "RETURNED", can_request: true }, "IDEA")).toBe("returned");
    expect(studioPresaleStage({ status: "APPROVED" }, "IN_PRODUCTION")).toBe("approved_waiting_price");
    expect(studioPresaleStage({ status: "APPROVED", listed: true, open: true }, "IN_PRODUCTION")).toBe("live");
    expect(studioPresaleStage({ status: "APPROVED", listed: true, open: false }, "METADATA_REVIEW")).toBe("closed");
    expect(studioPresaleStage({ listed: false }, "SCHEDULED")).toBe("scheduled");
  });


  it("marks pre-orders on orders", () => {
    expect(preorderNote({ is_presale: true })).toBe("Pre-order · unlocks on release day");
    expect(preorderNote({ is_presale: false })).toBeNull();
    expect(preorderNote({})).toBeNull();
  });
});

describe("release-day opening", () => {
  it("opens once for a browser that saw the pre-sale", async () => {
    const { rememberPresaleSeen, takePresaleSeen } = await import("./presale-view");
    const data = new Map<string, string>();
    const store = {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, v),
      removeItem: (k: string) => void data.delete(k),
    };
    expect(takePresaleSeen("r1", store)).toBe(false);
    rememberPresaleSeen("r1", store);
    expect(takePresaleSeen("r1", store)).toBe(true);
    expect(takePresaleSeen("r1", store)).toBe(false);
    const broken = { getItem: () => { throw new Error("off"); }, setItem: () => { throw new Error("off"); }, removeItem: () => undefined };
    expect(() => rememberPresaleSeen("r2", broken)).not.toThrow();
    expect(takePresaleSeen("r2", broken)).toBe(false);
  });
});
