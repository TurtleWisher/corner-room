import { describe, expect, it } from "vitest";

import { EMPTY_AUDIENCE } from "@/features/artist-mail/api";
import {
  audienceLine,
  fromLocalInput,
  isPicked,
  musicLine,
  parseRich,
  percent,
  plainText,
  previewValues,
  reachLine,
  reachOf,
  readyToSend,
  sentLine,
  thankYouLabel,
  TICK_ALL,
  togglePick,
  toLocalInput,
  unfilledMarks,
  unknownFillIns,
  UNTICK_ALL,
  valuesFor,
} from "./artist-mail-view";

const song = { type: "TRACK" as const, id: "t1", title: "Chaya Pore" };

describe("fill-ins and links", () => {
  it("reads text, fill-ins and links like the server", () => {
    expect(parseRich("Hi {first_name}, see [the video](https://youtu.be/x).")).toEqual([
      { kind: "text", text: "Hi " },
      { kind: "fill", key: "first_name" },
      { kind: "text", text: ", see " },
      { kind: "link", label: "the video", url: "https://youtu.be/x" },
      { kind: "text", text: "." },
    ]);
    expect(parseRich("[x](javascript:alert(1))").every((t) => t.kind === "text")).toBe(true);
  });

  it("fills in one buyer's own words, as in the owner's example", () => {
    const values = valuesFor("Alam", ["Chaya Pore"], "MIZULS");
    expect(plainText("Thank you for buying {music}", values)).toBe("Thank you for buying Chaya Pore");
    expect(plainText("Hi {first_name},", values)).toBe("Hi Alam,");
    expect(valuesFor(null, [], "MIZULS")).toEqual({ first_name: "friend", buyer_name: "friend", music: "your music", artist: "MIZULS" });
    expect(previewValues({ name: "Name not given", has_name: false, bought: [] }, ["Low Tide"], "X").buyer_name).toBe("friend");
    expect(previewValues({ name: "Rumi Khan", has_name: true, bought: ["Chaya Pore"] }, ["Low Tide"], "X").music).toBe("Chaya Pore");
  });

  it("finds places to complete and fill-in typos", () => {
    expect(unfilledMarks("Hi.\n\n[add your news]\n\n[a link](https://a.b)")).toEqual(["[add your news]"]);
    expect(unknownFillIns("{first_name} {name} {music}")).toEqual(["{name}"]);
  });

  it("lists music the way emails say it", () => {
    expect(musicLine([])).toBe("your music");
    expect(musicLine(["A", "B", "C", "D"])).toBe("A, B, C and 1 more");
  });
});

describe("picking people", () => {
  const people = [
    { ref: "a", stopped: false },
    { ref: "b", stopped: true },
    { ref: "c", stopped: false },
  ];

  it("ticks everyone, leaves people out, or picks only some", () => {
    expect(reachOf(people, TICK_ALL)).toEqual({ count: 2, stopped: 1 });
    const leaveOutA = togglePick(TICK_ALL, "a");
    expect(isPicked(leaveOutA, "a")).toBe(false);
    expect(reachOf(people, leaveOutA)).toEqual({ count: 1, stopped: 1 });
    const onlyC = togglePick(UNTICK_ALL, "c");
    expect(reachOf(people, onlyC)).toEqual({ count: 1, stopped: 0 });
    expect(togglePick(onlyC, "c")).toEqual(UNTICK_ALL);
  });

  it("is ready only with words, music and somebody picked", () => {
    const audience = { ...EMPTY_AUDIENCE, works: [song] };
    expect(readyToSend({ subject: "Hi", body: "Hello", audience })).toBe(true);
    expect(readyToSend({ subject: "Hi", body: "Hello", audience: { ...audience, pick: UNTICK_ALL } })).toBe(false);
    expect(readyToSend({ subject: "Hi", body: "", audience })).toBe(false);
  });
});

describe("lines", () => {
  it("says who an email goes to", () => {
    expect(audienceLine({ ...EMPTY_AUDIENCE, works: [song], who: "PRESALE" })).toBe("Pre-sale buyers of Chaya Pore");
    expect(audienceLine({ ...EMPTY_AUDIENCE, works: [song], buyer_type: "RETURNING", min_owned: 3, pick: { mode: "ALL_BUT", refs: ["x"] } })).toBe(
      "Everyone who bought Chaya Pore · returning buyers · own 3 or more of your songs and releases · 1 left out by name",
    );
    expect(thankYouLabel({ works: [], who: "ALL" })).toBe("Everyone · any of your music");
    expect(thankYouLabel({ works: [song], who: "PRESALE" })).toBe("Pre-sale buyers · Chaya Pore");
  });

  it("counts reach and sending honestly", () => {
    expect(reachLine({ count: 1, stopped: 2 })).toBe("Goes to 1 person (2 stopped your emails)");
    expect(sentLine({ status: "SENT", recipient_count: 3, counts: { PENDING: 0, SENT: 2, SUPPRESSED: 0, FAILED: 1 } })).toBe(
      "Sent to 2 people, 1 couldn't be delivered",
    );
    expect(sentLine({ status: "DRAFT", counts: {} })).toBeNull();
    expect(percent(null)).toBe("Not available");
    expect(percent(0.256)).toBe("26%");
    expect(percent(0.034)).toBe("3.4%");
  });

  it("keeps a chosen time in Bangladesh time", () => {
    expect(fromLocalInput("2026-11-03T20:00")).toBe("2026-11-03T20:00:00+06:00");
    expect(toLocalInput("2026-11-03T14:00:00Z")).toBe("2026-11-03T20:00");
    expect(fromLocalInput("soon")).toBeNull();
  });
});
