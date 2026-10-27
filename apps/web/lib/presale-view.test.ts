import { describe, expect, it } from "vitest";

import { parsePaidOn, parsePresaleList, presaleTotal, splitLine } from "./presale-view";

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
