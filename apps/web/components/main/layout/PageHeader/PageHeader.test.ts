import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PageHeader } from "./PageHeader";

const header = (props: Partial<Parameters<typeof PageHeader>[0]>) =>
  renderToStaticMarkup(h(PageHeader, { title: "Kontakt oss", layout: "hero", ...props }));

describe("PageHeader contact CTA", () => {
  it("renders the button on a hero with no intro and no links", () => {
    const html = header({
      cta_type: "contact",
      cta_label: "Send e-post",
      cta_email: "info@gieffektivt.no",
    });
    expect(html).toContain('data-cy="hero-cta-contact"');
    expect(html).toContain('href="mailto:info@gieffektivt.no"');
    expect(html).toContain("Send e-post");
  });

  it("renders the button next to the intro", () => {
    const html = header({
      inngress: "Vi svarer innen en uke.",
      cta_type: "contact",
      cta_label: "Send e-post",
      cta_email: "info@gieffektivt.no",
    });
    expect(html).toContain("Vi svarer innen en uke.");
    expect(html).toContain('data-cy="hero-cta-contact"');
  });

  it("renders no button when the e-mail is missing or invalid", () => {
    expect(header({ cta_type: "contact", cta_label: "Send e-post" })).not.toContain(
      "hero-cta-contact",
    );
    expect(
      header({ cta_type: "contact", cta_email: "info@gieffektivt.no?cc=x@y.no" }),
    ).not.toContain("hero-cta-contact");
  });

  it("renders no button outside the hero layout", () => {
    const html = header({
      layout: "default",
      cta_type: "contact",
      cta_email: "info@gieffektivt.no",
    });
    expect(html).not.toContain("hero-cta-contact");
  });
});
