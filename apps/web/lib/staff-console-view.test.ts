import { describe, expect, it } from "vitest";

import { badgeText, choiceLabel, choicesFrom, fieldWords, findPages, findQueues, pageOf, queuesOn, sortQueues, stepIndex, waitingByPage, waitingTotal } from "./staff-console-view";

describe("fieldWords", () => {
  it("turns a placeholder into a label", () => {
    expect(fieldWords("Task title")).toEqual({ label: "Task title", hint: null, example: null });
  });
  it("explains minor units instead of asking staff to know them", () => {
    const w = fieldWords("Amount (minor units)");
    expect(w?.label).toBe("Amount");
    expect(w?.hint).toContain("15000 means ৳150.00");
    expect(fieldWords("Minimum threshold (minor units)")?.label).toBe("Minimum threshold");
  });
  it("moves a bracketed note under the field", () => {
    expect(fieldWords("Metric key (not an actual)")).toEqual({ label: "Metric key", hint: "Not an actual.", example: null });
  });
  it("leaves examples and empty placeholders alone", () => {
    expect(fieldWords("e.g. 120")).toBeNull();
    expect(fieldWords("their-email@example.com")).toBeNull();
    expect(fieldWords("")).toBeNull();
    expect(fieldWords(undefined)).toBeNull();
  });
});

describe("choicesFrom", () => {
  it("reads a typed list of codes as choices", () => {
    expect(choicesFrom("ARTIST | RELEASE | EVENT")).toEqual(["ARTIST", "RELEASE", "EVENT"]);
    expect(choicesFrom("IN_APP | EMAIL | SOCIAL | PRESS | OTHER")?.length).toBe(5);
  });
  it("is nothing for ordinary words", () => {
    expect(choicesFrom("Task title")).toBeNull();
    expect(choicesFrom("ARTIST")).toBeNull();
    expect(choicesFrom("Email or phone")).toBeNull();
  });
  it("labels a code in plain words", () => {
    expect(choiceLabel("IN_APP")).toBe("In app");
    expect(choiceLabel("EVENT")).toBe("Event");
  });
});

const sections = [
  { label: "Catalog", items: [{ href: "/staff/catalog", label: "Releases" }, { href: "/staff/catalog/trending", label: "Trending Corner" }] },
  { label: "Money", items: [{ href: "/staff/finance", label: "Finance" }] },
];

describe("findPages", () => {
  it("lists every page with no query", () => {
    expect(findPages(sections, " ").length).toBe(3);
  });
  it("matches a page or its section, any word order", () => {
    expect(findPages(sections, "trend").map((p) => p.href)).toEqual(["/staff/catalog/trending"]);
    expect(findPages(sections, "money").map((p) => p.href)).toEqual(["/staff/finance"]);
    expect(findPages(sections, "corner catalog").length).toBe(1);
    expect(findPages(sections, "nothing here")).toEqual([]);
  });
  it("steps round the list", () => {
    expect(stepIndex(0, -1, 3)).toBe(2);
    expect(stepIndex(2, 1, 3)).toBe(0);
    expect(stepIndex(5, 1, 0)).toBe(0);
  });
});

describe("queues", () => {
  const q = [
    { key: "a", label: "Prices", href: "/x", count: 0 },
    { key: "b", label: "Previews", href: "/x", count: 3 },
    { key: "c", label: "Lyrics", href: "/x", count: null },
    { key: "d", label: "Covers", href: "/x", count: 7 },
  ];
  it("puts what is waiting first and unknown last", () => {
    expect(sortQueues(q).map((x) => x.key)).toEqual(["d", "b", "a", "c"]);
  });
  it("adds only known counts", () => {
    expect(waitingTotal(q)).toBe(10);
  });
});

describe("waiting counts across the console (owner, 2026-11-21)", () => {
  const queues = [
    { key: "lyrics", label: "Lyrics to review", href: "/staff/catalog#q-lyrics", count: 2 },
    { key: "covers", label: "Covers to review", href: "/staff/catalog#q-covers", count: 0 },
    { key: "mail", label: "Artist emails to review", href: "/staff/catalog#q-mail", count: null },
    { key: "releases", label: "Releases to review", href: "/staff/catalog#q-releases", count: 3 },
    { key: "refunds", label: "Refunds open", href: "/staff/commerce", count: 120 },
  ];

  it("adds each page's waiting work for the menu badges, never counting the unknown", () => {
    expect(pageOf("/staff/catalog#q-lyrics")).toBe("/staff/catalog");
    expect(waitingByPage(queues)).toEqual({ "/staff/catalog": 5, "/staff/commerce": 120 });
    expect(badgeText(120)).toBe("99+");
    expect(badgeText(7)).toBe("7");
  });

  it("lists only the queues with work on a page for its jump bar", () => {
    expect(queuesOn("/staff/catalog", queues).map((q) => q.key)).toEqual(["lyrics", "releases"]);
    expect(queuesOn("/staff/commerce", queues)).toEqual([]);
  });

  it("finds waiting queues by their words", () => {
    expect(findQueues(queues, "review").map((q) => q.key)).toEqual(["lyrics", "releases"]);
    expect(findQueues(queues, "lyr").map((q) => q.key)).toEqual(["lyrics"]);
    expect(findQueues(queues, "covers")).toEqual([]);
  });
});
