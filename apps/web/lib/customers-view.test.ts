import { describe, expect, it } from "vitest";

import { csvCell, csvFileName, customersCsv, filterCustomers, followersCsv, NO_FILTERS, type CustomerRow } from "./customers-view";

const row = (over: Partial<CustomerRow>): CustomerRow => ({
  key: "k",
  name: "Nadia",
  email: "nadia@example.com",
  phone: null,
  address: null,
  user_id: "u1",
  account_status: "ACTIVE",
  email_verified: true,
  joined_at: "2026-10-26T10:00:00Z",
  orders: 1,
  spent: { BDT: 11400 },
  last_order_at: "2026-10-26T11:00:00Z",
  presales: [],
  sources: ["WEBSITE"],
  ...over,
});

describe("filterCustomers", () => {
  const web = row({ key: "a" });
  const pre = row({ key: "b", user_id: null, sources: ["PRESALE"], email_verified: false, joined_at: null, orders: 0, phone: "017", address: "Dhaka" });
  const both = row({ key: "c", sources: ["WEBSITE", "PRESALE"], phone: "018", joined_at: "2026-10-20T00:00:00Z", orders: 3 });
  const all = [web, pre, both];
  const keys = (rows: CustomerRow[]) => rows.map((r) => r.key);

  it("lets everyone through with no filters", () => {
    expect(keys(filterCustomers(all, NO_FILTERS))).toEqual(["a", "b", "c"]);
  });
  it("filters by source, verification, phone, address, join date and orders", () => {
    expect(keys(filterCustomers(all, { ...NO_FILTERS, source: "website" }))).toEqual(["a", "c"]);
    expect(keys(filterCustomers(all, { ...NO_FILTERS, source: "presale" }))).toEqual(["b", "c"]);
    expect(keys(filterCustomers(all, { ...NO_FILTERS, source: "both" }))).toEqual(["c"]);
    expect(keys(filterCustomers(all, { ...NO_FILTERS, verified: "no" }))).toEqual(["b"]);
    expect(keys(filterCustomers(all, { ...NO_FILTERS, hasPhone: true }))).toEqual(["b", "c"]);
    expect(keys(filterCustomers(all, { ...NO_FILTERS, hasAddress: true }))).toEqual(["b"]);
    expect(keys(filterCustomers(all, { ...NO_FILTERS, joinedFrom: "2026-10-21" }))).toEqual(["a"]);
    expect(keys(filterCustomers(all, { ...NO_FILTERS, joinedTo: "2026-10-20" }))).toEqual(["c"]);
    expect(keys(filterCustomers(all, { ...NO_FILTERS, minOrders: 2 }))).toEqual(["c"]);
  });
});

describe("CSV", () => {
  it("quotes commas and quotes, and never lets a cell run as a spreadsheet formula", () => {
    expect(csvCell("House 1, Road 2")).toBe('"House 1, Road 2"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("=HYPERLINK(\"x\")")).toBe("\"'=HYPERLINK(\"\"x\"\")\"");
    expect(csvCell("+8801711")).toBe("'+8801711");
    expect(csvCell("@me")).toBe("'@me");
    expect(csvCell(null)).toBe("");
  });
  it("writes customers with money in major units, a column per currency, and a BOM for Excel", () => {
    const csv = customersCsv([
      row({ presales: [{ product: "Chaya Pore", amount_minor: 11400, currency_code: "BDT", paid_on: null, status: "CLAIMED" }] }),
    ]);
    expect(csv.startsWith("﻿Name,Email,Phone,Address,Source,Has account,Email verified,Joined,Orders,Spent (BDT),Last order,Pre-sales\r\n")).toBe(true);
    expect(csv).toContain("Nadia,nadia@example.com,,,WEBSITE,Yes,Yes,2026-10-26,1,114.00,2026-10-26,Chaya Pore: BDT 114.00 (claimed)");
  });
  it("writes followers and a safe file name", () => {
    expect(followersCsv([{ user_id: "u", name: "Mira", email: "m@example.com", phone: null, followed_at: "2026-10-27T01:00:00Z" }])).toBe(
      "﻿Name,Email,Phone,Followed on\r\nMira,m@example.com,,2026-10-27\r\n",
    );
    expect(csvFileName(["Customers", "MIZULS / Chaya Pore"], "2026-10-27")).toBe("corner-room-customers-mizuls-chaya-pore-2026-10-27.csv");
    expect(csvFileName([], "2026-10-27")).toBe("corner-room-list-2026-10-27.csv");
  });
});
