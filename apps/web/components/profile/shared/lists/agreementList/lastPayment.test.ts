import { describe, expect, it } from "vitest";
import { formatLastPayment, lastPaymentByKid } from "./lastPayment";

describe("lastPaymentByKid", () => {
  it("keeps the newest donation per KID, whatever the order", () => {
    const latest = lastPaymentByKid([
      { KID: "111", timestamp: "2026-09-01T10:00:00.000Z" },
      { KID: "222", timestamp: "2026-08-15T10:00:00.000Z" },
      { KID: "111", timestamp: "2026-10-01T10:00:00.000Z" },
      { KID: "111", timestamp: "2026-07-01T10:00:00.000Z" },
    ]);
    expect(latest.get("111")).toBe("2026-10-01T10:00:00.000Z");
    expect(latest.get("222")).toBe("2026-08-15T10:00:00.000Z");
  });

  it("has nothing for a KID without donations", () => {
    expect(lastPaymentByKid([]).get("111")).toBeUndefined();
  });
});

describe("formatLastPayment", () => {
  it("stays empty while the donations load", () => {
    expect(formatLastPayment(undefined, false, "Ingen ennå")).toBe("");
  });

  it("shows the editor's text when the agreement has no payment yet", () => {
    expect(formatLastPayment(undefined, true, "Ingen ennå")).toBe("Ingen ennå");
  });

  it("shows nothing when the editor left the text empty", () => {
    expect(formatLastPayment(undefined, true, undefined)).toBe("");
  });

  it("shows the date of the last payment", () => {
    expect(formatLastPayment("2026-10-01T10:00:00", true, "Ingen ennå")).toBe("01.10.2026");
  });
});
