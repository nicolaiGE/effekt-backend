import { describe, expect, it } from "vitest";
import { headingTag } from "./headingLevels";

describe("headingTag", () => {
  it("keeps a paragraph when nothing is chosen", () => {
    expect(headingTag(undefined)).toBe("p");
    expect(headingTag(null)).toBe("p");
    expect(headingTag("")).toBe("p");
  });

  it("uses the chosen heading level", () => {
    expect(headingTag("h2")).toBe("h2");
    expect(headingTag("h3")).toBe("h3");
  });

  it("falls back to a paragraph for a value that is not offered", () => {
    expect(headingTag("h1")).toBe("p");
    expect(headingTag("script")).toBe("p");
  });
});
