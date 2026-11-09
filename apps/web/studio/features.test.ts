import { describe, expect, it } from "vitest";
import { isFeatureOn } from "./features";

describe("isFeatureOn", () => {
  it("keeps every feature on when nothing is turned off", () => {
    expect(isFeatureOn(undefined, "dashboard")).toBe(true);
    expect(isFeatureOn(null, "results")).toBe(true);
    expect(isFeatureOn([], "fundraisers")).toBe(true);
  });

  it("turns off only the listed features", () => {
    expect(isFeatureOn(["fundraisers"], "fundraisers")).toBe(false);
    expect(isFeatureOn(["fundraisers"], "dashboard")).toBe(true);
  });
});
