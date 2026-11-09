import React from "react";
import style from "./PageHeader.module.scss";
import { NavLink } from "../../../shared/components/Navbar/Navbar";
import { Links, LinkType } from "../../blocks/Links/Links";
import type { SanityImageObject } from "@sanity/image-url";
import { ResponsiveImage } from "../../../shared/responsiveimage";
import { OpenWidgetButton } from "../../../shared/components/OpenWidgetButton/OpenWidgetButton";
import buttonStyles from "../../../shared/components/EffektButton/EffektButton.module.scss";
import { contactHref } from "./contactHref";

export const PageHeader: React.FC<{
  title: string;
  inngress?: string;
  layout?: "default" | "centered" | "hero" | "coverPhoto" | "noheader";
  coverPhoto?: SanityImageObject;
  cta_type?: "link" | "navitem" | "open_widget" | "contact";
  cta_label?: string;
  cta_email?: string;
  cta_cause_area_id?: number;
  cta_organization_id?: number;
  accent_color?: string;
  links?: (LinkType | NavLink)[];
}> = ({
  title,
  inngress,
  links,
  layout = "default",
  cta_type,
  cta_label,
  cta_email,
  cta_cause_area_id,
  cta_organization_id,
  accent_color,
  coverPhoto,
}) => {
  const contactLink =
    layout === "hero" && cta_type === "contact" ? contactHref(cta_email) : undefined;
  // Intro and links are optional, so the contact button alone is enough to render this block
  const hasmetacontent = inngress || links || contactLink;

  if (layout === "noheader") {
    return <div className={style.spacer}></div>;
  }

  return (
    <section
      className={`${style.pageheader} ${hasmetacontent ? style.pageheadermeta : null} ${
        style[layout]
      }`}
    >
      <div data-cy="header-container">
        {layout !== "coverPhoto" && title && <h1>{title}</h1>}
        {layout === "coverPhoto" && coverPhoto && (
          <ResponsiveImage
            image={coverPhoto}
            alt={title}
            layout={"responsive"}
            sizes="(min-width: 1920px) 1714px, 90vw"
          />
        )}
      </div>
      {hasmetacontent ? (
        <div>
          {inngress ? <p className="inngress">{inngress}</p> : null}
          {links ? <Links links={links} /> : null}
          {layout === "hero" && cta_type === "open_widget" ? (
            <OpenWidgetButton
              label={cta_label}
              accent_color={accent_color}
              causeAreaId={cta_cause_area_id}
              organizationId={cta_organization_id}
              cy={"hero-cta-open-widget"}
            />
          ) : null}
          {contactLink ? (
            <a
              href={contactLink}
              className={`${buttonStyles.button} ${
                accent_color ? buttonStyles.buttonaccent : buttonStyles.buttonprimary
              }`}
              style={
                {
                  ...ctaButtonStyleOverrides,
                  ...(accent_color ? { "--accent-color": accent_color } : {}),
                } as React.CSSProperties
              }
              data-cy="hero-cta-contact"
            >
              {cta_label}
            </a>
          ) : null}
        </div>
      ) : null}
    </section>
  );
};

export const ctaButtonStyleOverrides = {
  alignSelf: "start",
  padding: ".75rem 4rem",
  marginTop: "1rem",
};
