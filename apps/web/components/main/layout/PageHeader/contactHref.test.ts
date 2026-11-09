import { describe, expect, it } from "vitest";
import { contactHref } from "./contactHref";

describe("contactHref", () => {
  it("returns a mailto link for a valid address", () => {
    expect(contactHref("info@gieffektivt.no")).toBe("mailto:info@gieffektivt.no");
  });

  it("trims surrounding spaces", () => {
    expect(contactHref("  info@gieffektivt.no ")).toBe("mailto:info@gieffektivt.no");
  });

  it("returns undefined for an empty or missing address", () => {
    expect(contactHref(undefined)).toBeUndefined();
    expect(contactHref(null)).toBeUndefined();
    expect(contactHref("")).toBeUndefined();
  });

  it("returns undefined for an address that is not valid", () => {
    expect(contactHref("info")).toBeUndefined();
    expect(contactHref("info@")).toBeUndefined();
    expect(contactHref("info@gieffektivt")).toBeUndefined();
    expect(contactHref("in fo@gieffektivt.no")).toBeUndefined();
  });

  it("does not let the address add mailto parameters or a second recipient", () => {
    expect(contactHref("info@gieffektivt.no?cc=x@y.no")).toBeUndefined();
    expect(contactHref("info@gieffektivt.no&body=hi")).toBeUndefined();
    expect(contactHref("a@b.no,c@d.no")).toBeUndefined();
    expect(contactHref("a@b.no,c")).toBeUndefined();
    expect(contactHref("a@b.no;c")).toBeUndefined();
    expect(contactHref("javascript:alert(1)//@x.no")).toBeUndefined();
  });
});
