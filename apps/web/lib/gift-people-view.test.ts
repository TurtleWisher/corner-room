import { describe, expect, it } from "vitest";

import { addedMessage, headerColumns, parsePeopleSheet, phoneKey, rowProblem, sendable, splitCells } from "./gift-people-view";

describe("splitCells", () => {
  it("reads sheet tabs, commas and quoted CSV cells", () => {
    expect(splitCells("Nila\tnila@example.com\t01712345678")).toEqual(["Nila", "nila@example.com", "01712345678"]);
    expect(splitCells('Nila, nila@example.com, "House 1, Road 2"')).toEqual(["Nila", "nila@example.com", "House 1, Road 2"]);
    expect(splitCells('"Say ""hi"""')).toEqual(['Say "hi"']);
  });
});

describe("headerColumns", () => {
  it("follows a header row in any order", () => {
    expect(headerColumns(["Phone", "Full name", "Delivery address", "Email"])).toEqual({ phone: 0, name: 1, address: 2, email: 3 });
  });
  it("is not a header when the line is a person", () => {
    expect(headerColumns(["Nila", "nila@example.com"])).toBeNull();
  });
});

describe("parsePeopleSheet", () => {
  it("uses the header row's columns", () => {
    const rows = parsePeopleSheet("Name\tPhone\tAddress\nRafi Hasan\t+880 1712-345678\tHouse 1, Dhaka");
    expect(rows).toEqual([{ name: "Rafi Hasan", email: null, phone: "+880 1712-345678", address: "House 1, Dhaka", problem: null }]);
  });
  it("guesses each cell without a header, putting the address back together", () => {
    const [row] = parsePeopleSheet("Nila Akter, NILA@example.com, 01812345678, House 2, Road 5, Sylhet");
    expect(row).toEqual({ name: "Nila Akter", email: "nila@example.com", phone: "01812345678", address: "House 2, Road 5, Sylhet", problem: null });
  });
  it("keeps the same email or phone once, and says what is wrong with a row", () => {
    const rows = parsePeopleSheet("A\ta@example.com\nB\tA@example.com\nC\t+8801712345678\nD\t8801712345678\nE only");
    expect(rows.map((r) => r.name)).toEqual(["A", "C", "E only"]);
    expect(rows[2].problem).toBe("Needs an email or a phone");
    expect(sendable(rows)).toHaveLength(2);
  });
  it("is empty for empty text", () => {
    expect(parsePeopleSheet("  \n\n")).toEqual([]);
  });
});

describe("small helpers", () => {
  it("matches phones written two ways", () => {
    expect(phoneKey("+880 1712-345678")).toBe(phoneKey("8801712345678"));
  });
  it("names the problem with a row", () => {
    expect(rowProblem({ name: "X", email: "bad", phone: null, address: null })).toBe("bad isn't an email address");
    expect(rowProblem({ name: "X", email: null, phone: "12", address: null })).toBe("12 isn't a phone number");
  });
  it("says what happened after adding", () => {
    expect(addedMessage(2, 1, true)).toBe("2 people added. 1 person already on the list, so left as they were. They count once Corner Room approves them.");
    expect(addedMessage(1, 0, false)).toBe("1 person added.");
  });
});
