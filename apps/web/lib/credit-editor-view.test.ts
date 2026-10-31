import { describe, expect, it } from "vitest";

import {
  actOptions,
  creditsNote,
  isChanged,
  keepActsValid,
  partOfFields,
  partOfValue,
  profileMatches,
  profilesFrom,
} from "./credit-editor-view";

const profiles = profilesFrom(
  [
    { id: "a1", stage_name: "Rumi", portrait_asset_id: "p1" },
    { id: "a2", stage_name: "Rafi Ahmed" },
    { id: "a3", stage_name: "Arif Rumi" },
  ],
  [
    { id: "b1", name: "MIZULS" },
    { id: "a1", name: "Duplicate" },
  ],
);

describe("profilesFrom", () => {
  it("lists solo artists and bands once each", () => {
    expect(profiles.map((p) => `${p.name}:${p.kind}`)).toEqual(["Rumi:SOLO", "Rafi Ahmed:SOLO", "Arif Rumi:SOLO", "MIZULS:BAND"]);
    expect(profiles[0].picture).toBe("p1");
  });
});

describe("profileMatches", () => {
  it("puts exact and starting matches first, then a word, then anywhere", () => {
    expect(profileMatches("rumi", profiles).map((p) => p.name)).toEqual(["Rumi", "Arif Rumi"]);
    expect(profileMatches("ra", profiles).map((p) => p.name)).toEqual(["Rafi Ahmed"]);
    expect(profileMatches("zul", profiles).map((p) => p.name)).toEqual(["MIZULS"]);
    expect(profileMatches("  ", profiles)).toEqual([]);
    expect(profileMatches("r", profiles, 1)).toHaveLength(1);
  });
});

describe("acts a musician can belong to (D-CREDITS-05)", () => {
  const rows = [
    { role_key: "songwriter", artist_id: "b1" },
    { role_key: "mixing_engineer", display_name: " M.K. Khan " },
    { role_key: "producer", display_name: "m.k. khan" },
    { role_key: "musician", display_name: "Rafi", instrument: "Guitars", part_of_artist_id: "b1" },
    { role_key: "songwriter", display_name: "  " },
  ];

  it("offers every credited act once, never a musician", () => {
    expect(actOptions(rows, profiles)).toEqual([
      { value: "id:b1", label: "MIZULS" },
      { value: "name:m.k. khan", label: "M.K. Khan" },
    ]);
  });

  it("turns a choice into row fields and back", () => {
    const options = actOptions(rows, profiles);
    expect(partOfFields("id:b1", options)).toEqual({ part_of_artist_id: "b1", part_of_name: null });
    expect(partOfFields("name:m.k. khan", options)).toEqual({ part_of_artist_id: null, part_of_name: "M.K. Khan" });
    expect(partOfFields("", options)).toEqual({ part_of_artist_id: null, part_of_name: null });
    expect(partOfValue({ part_of_name: "M.K.  Khan" })).toBe("name:m.k. khan");
    expect(partOfValue({})).toBe("");
  });

  it("names a typed act by the stage name of the one profile it matches", () => {
    expect(actOptions([{ role_key: "producer", display_name: "mizuls" }], profiles)).toEqual([{ value: "name:mizuls", label: "MIZULS" }]);
  });

  it("forgets an act that is no longer credited", () => {
    const out = keepActsValid([{ role_key: "musician", display_name: "Rafi", part_of_artist_id: "b1" }], profiles);
    expect(out[0].part_of_artist_id).toBeNull();
    expect(keepActsValid(rows, profiles)[3].part_of_artist_id).toBe("b1");
  });
});

describe("creditsNote", () => {
  it("says where a change goes at each stage", () => {
    expect(creditsNote("draft").title).toBe("Draft");
    expect(creditsNote("live").body).toContain("no review");
    expect(creditsNote("changing").body).toContain("until Corner Room approves");
    expect(creditsNote("locked").title).toBe("Waiting for review");
  });
});

describe("isChanged", () => {
  it("marks new or edited rows against what fans see", () => {
    const live = [{ role_key: "producer", display_name: "Mitul" }];
    expect(isChanged({ role_key: "producer", display_name: " Mitul " }, live)).toBe(false);
    expect(isChanged({ role_key: "producer", display_name: "Mitul Das" }, live)).toBe(true);
  });
});
