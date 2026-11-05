import { describe, expect, it } from "vitest";

import type { MusicGiftPerson } from "@/features/music-gifts/api";
import { countsLine, giftStarter, GIFT_FILL_INS, mergePeople, missingParts, parsePeople, reportCsv } from "@/lib/music-gift-view";

describe("parsePeople", () => {
  it("reads plain lists, names in angle brackets, commas and sheet columns", () => {
    const { people, invalid } = parsePeople(
      [
        "Friend@Example.com",
        "Rumi Khan <rumi@example.com>",
        "radio@example.com, Radio Host",
        "a@example.com; b@example.com",
        "dj@example.com DJ Night",
        "Studio Pal\tpal@example.com\tThanks for mixing",
        "friend@example.com",
        "not an address",
        "",
      ].join("\n"),
    );
    expect(people).toEqual([
      { email: "friend@example.com", name: null, note: null },
      { email: "rumi@example.com", name: "Rumi Khan", note: null },
      { email: "radio@example.com", name: "Radio Host", note: null },
      { email: "a@example.com", name: null, note: null },
      { email: "b@example.com", name: null, note: null },
      { email: "dj@example.com", name: "DJ Night", note: null },
      { email: "pal@example.com", name: "Studio Pal", note: "Thanks for mixing" },
    ]);
    expect(invalid).toEqual(["not an address"]);
  });

  it("names addresses that aren't real", () => {
    expect(parsePeople("someone@nowhere, x@y").invalid).toEqual(["someone@nowhere", "x@y"]);
  });
});

describe("list and words", () => {
  it("merges without repeating an address", () => {
    expect(mergePeople([{ email: "a@example.com", name: "A" }], [{ email: "A@example.com" }, { email: "b@example.com" }])).toEqual([
      { email: "a@example.com", name: "A" },
      { email: "b@example.com" },
    ]);
  });

  it("says how many and what happened", () => {
    const counts = { WAITING: 0, GIVEN: 2, WAITING_ACCOUNT: 1, ALREADY_OWNED: 0, TOTAL: 3 };
    expect(countsLine(counts, "DRAFT")).toBe("3 people");
    expect(countsLine(counts, "SENT")).toBe("3 people: 2 have it now · 1 to sign up");
    expect(countsLine({ ...counts, GIVEN: 1, WAITING_ACCOUNT: 0, TOTAL: 1 }, "SENT")).toBe("1 person: 1 has it now");
  });

  it("lists what is missing before review", () => {
    expect(missingParts({ works: [], people: [], subject: " ", body: "" })).toEqual(["the music", "who it is for", "a subject", "a message"]);
    expect(missingParts({ works: [1], people: [1], subject: "s", body: "b" })).toEqual([]);
  });

  it("starts in the act's own voice with fill-ins", () => {
    expect(giftStarter("I").body).toContain("I'd love you to have {music}, as a gift from me.");
    expect(giftStarter("we").body).toContain("We'd love you to have {music}, as a gift from us.");
    expect(GIFT_FILL_INS.find((f) => f.key === "music")?.label).toBe("The music");
  });

  it("writes the report as CSV", () => {
    const person: MusicGiftPerson = {
      id: "1",
      email: "a@example.com",
      name: "Rumi, K",
      note: null,
      status: "GIVEN",
      given_at: null,
      emailed_at: null,
      email_status: "SENT",
      clicks: 2,
    };
    expect(reportCsv([person])).toBe('Email,Name,Note,Status,Email status,Link clicks\na@example.com,"Rumi, K",,Has it now,Email sent,2\n');
  });
});
