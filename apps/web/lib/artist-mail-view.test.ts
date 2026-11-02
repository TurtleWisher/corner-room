import { describe, expect, it } from "vitest";

import {
  audienceLine,
  musicLine,
  previewFill,
  reachLine,
  readyToSend,
  sentLine,
  togglePicked,
  unknownFillIns,
} from "@/lib/artist-mail-view";

const works = [{ type: "RELEASE" as const, id: "r1", title: "Chaya Pore" }];

describe("artist mail view (D-MAIL-01)", () => {
  it("fills in the buyer, the music and the act, and leaves other braces alone", () => {
    expect(previewFill("Hi {buyer_name}, thanks for {music}. {artist} {name}", { buyer_name: "Rumi", music: "Chaya Pore", artist: "MIZULS" })).toBe(
      "Hi Rumi, thanks for Chaya Pore. MIZULS {name}",
    );
  });

  it("points out braced words that aren't fill-ins", () => {
    expect(unknownFillIns("Hi {name}, {buyer_name} {Music} {name}")).toEqual(["{name}", "{Music}"]);
    expect(unknownFillIns("Hi {buyer_name}")).toEqual([]);
  });

  it("says the music in a line", () => {
    expect(musicLine([])).toBe("No music chosen");
    expect(musicLine(["A", "B"])).toBe("A and B");
    expect(musicLine(["A", "B", "C", "D"])).toBe("A, B, C and 1 more");
  });

  it("says who an email goes to", () => {
    expect(audienceLine({ works, who: "ALL", picked: [] })).toBe("Everyone who bought Chaya Pore");
    expect(audienceLine({ works, who: "PRESALE", picked: [] })).toBe("Pre-sale buyers of Chaya Pore");
    expect(audienceLine({ works, who: "PICKED", picked: ["a"] })).toBe("1 picked person who bought Chaya Pore");
  });

  it("counts the people it reaches and those who stopped", () => {
    expect(reachLine(null)).toBe("Working out who gets it");
    expect(reachLine({ count: 0, stopped: 0 })).toBe("Nobody yet");
    expect(reachLine({ count: 1, stopped: 0 })).toBe("Goes to 1 person");
    expect(reachLine({ count: 12, stopped: 2 })).toBe("Goes to 12 people (2 stopped your emails)");
  });

  it("shows how far sending has got", () => {
    expect(sentLine({ status: "DRAFT", counts: { PENDING: 0, SENT: 0, SUPPRESSED: 0 } })).toBeNull();
    expect(sentLine({ status: "SENDING", recipient_count: 12, counts: { PENDING: 4, SENT: 8, SUPPRESSED: 0 } })).toBe("8 of 12 sent");
    expect(sentLine({ status: "SENT", recipient_count: 3, counts: { PENDING: 0, SENT: 2, SUPPRESSED: 1 } })).toBe(
      "Sent to 2 people, 1 stopped your emails first",
    );
  });

  it("picks and unpicks people, and knows when an email is ready", () => {
    expect(togglePicked(["a"], "b")).toEqual(["a", "b"]);
    expect(togglePicked(["a", "b"], "a")).toEqual(["b"]);
    const audience = { works, who: "PICKED" as const, picked: [] as string[] };
    expect(readyToSend({ subject: "Hi", body: "News", audience })).toBe(false);
    expect(readyToSend({ subject: "Hi", body: "News", audience: { ...audience, picked: ["a"] } })).toBe(true);
    expect(readyToSend({ subject: " ", body: "News", audience: { ...audience, who: "ALL" } })).toBe(false);
    expect(readyToSend({ subject: "Hi", body: "News", audience: { works: [], who: "ALL", picked: [] } })).toBe(false);
  });
});
