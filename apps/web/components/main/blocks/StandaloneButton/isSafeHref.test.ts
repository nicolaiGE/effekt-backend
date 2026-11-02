import { describe, expect, it } from "vitest";
import { isSafeHref } from "./isSafeHref";

describe("isSafeHref", () => {
  it("accepts paths on this site", () => {
    expect(isSafeHref("/om-oss")).toBe(true);
    expect(isSafeHref("/artikler/hvorfor-gi")).toBe(true);
    // The home page's slug is "/", so a navigation item to it gives "//"
    expect(isSafeHref("//")).toBe(true);
  });

  it("accepts web, e-mail and phone links", () => {
    expect(isSafeHref("https://open.spotify.com/episode/0LTFqPEL9l7x1g7CDYhAmi")).toBe(true);
    expect(isSafeHref("http://example.org")).toBe(true);
    expect(isSafeHref("mailto:info@gieffektivt.no")).toBe(true);
    expect(isSafeHref("tel:+4712345678")).toBe(true);
  });

  it("rejects empty links", () => {
    expect(isSafeHref("")).toBe(false);
    expect(isSafeHref("   ")).toBe(false);
  });

  it("rejects script and data links", () => {
    expect(isSafeHref("javascript:alert(1)")).toBe(false);
    expect(isSafeHref(" JavaScript:alert(1)")).toBe(false);
    expect(isSafeHref("data:text/html,<script>alert(1)</script>")).toBe(false);
  });

  it("rejects protocol-relative links to other hosts", () => {
    expect(isSafeHref("//evil.example")).toBe(false);
    expect(isSafeHref("/\\evil.example")).toBe(false);
  });
});
