import { describe, expect, it } from "vitest";
import {
  countUpValue,
  pledgeCreateInput,
  receivedInput,
  validatePledge,
  validateReceived,
} from "./model";

describe("overview", () => {
  it("counts up fast at first and lands exactly on the value", () => {
    expect(countUpValue(1000, 0, 900)).toBe(0);
    expect(countUpValue(1000, 450, 900)).toBeGreaterThan(800);
    expect(countUpValue(170245588, 900, 900)).toBe(170245588);
    expect(countUpValue(170245588, 5000, 900)).toBe(170245588);
  });

  it("counts on from the old value when a refresh brings a new one", () => {
    expect(countUpValue(170_250_000, 0, 900, 170_245_588)).toBe(170_245_588);
    const halfway = countUpValue(170_250_000, 450, 900, 170_245_588);
    expect(halfway).toBeGreaterThan(170_245_588);
    expect(halfway).toBeLessThan(170_250_000);
    expect(countUpValue(170_250_000, 900, 900, 170_245_588)).toBe(170_250_000);
  });
});

describe("pledge forms", () => {
  it("adds a pledge with an amount (comma or point) and a decision date", () => {
    expect(validatePledge({ sum: "", decidedDate: "" })).toEqual({
      sum: "Enter the amount",
      decidedDate: "Enter the date it was decided",
    });
    expect(validatePledge({ sum: "1 350 000,5", decidedDate: "2026-10-23" })).toEqual({
      sum: undefined,
      decidedDate: undefined,
    });
    expect(validatePledge({ sum: "10,555", decidedDate: "2026-10-23" }).sum).toMatch(
      /two decimals/,
    );
    expect(pledgeCreateInput({ sum: "1 350 000,5", decidedDate: "2026-10-23" })).toEqual({
      sum: 1350000.5,
      decidedDate: "2026-10-23",
    });
  });

  it("marks received with an optional donation", () => {
    expect(validateReceived({ receivedDate: "", donationId: "x" })).toEqual({
      receivedDate: "Enter the date the money came in",
      donationId: "Enter a donation ID (digits)",
    });
    expect(receivedInput(4, { receivedDate: "2026-11-02", donationId: " " })).toEqual({
      id: 4,
      receivedDate: "2026-11-02",
      donationId: null,
    });
    expect(receivedInput(4, { receivedDate: "2026-11-02", donationId: "42" }).donationId).toBe(42);
  });
});
