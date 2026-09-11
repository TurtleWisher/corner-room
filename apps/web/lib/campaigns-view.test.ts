import { describe, expect, it } from "vitest";

import { campaignAttributionLabel, campaignStatusLabel } from "./campaigns-view";

describe("campaign display helpers", () => {
  it("labels KPI targets as not attributed", () => {
    expect(campaignAttributionLabel("ATTRIBUTION_UNDEFINED")).toBe("Not attributed");
  });

  it("does not invent analytics copy for other statuses", () => {
    expect(campaignAttributionLabel("ROAS")).toBe("ROAS");
  });

  it("renders architecture statuses in English", () => {
    expect(campaignStatusLabel("CONTENT_PREPARATION")).toBe("CONTENT PREPARATION");
  });
});
