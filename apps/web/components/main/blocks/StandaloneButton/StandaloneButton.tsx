import Link from "next/link";
import React from "react";
import { NavLink } from "../../../shared/components/Navbar/Navbar";
import { useRouterContext } from "../../../../context/RouterContext";
import buttonStyles from "../../../shared/components/EffektButton/EffektButton.module.scss";
import { getHref, isAbsoluteUrl, LinkType } from "../Links/Links";
import { isSafeHref } from "./isSafeHref";
import styles from "./StandaloneButton.module.scss";

export const StandaloneButton: React.FC<{ links?: (LinkType | NavLink)[] }> = ({ links }) => {
  const { articlesPagePath, fundraisersPath } = useRouterContext();
  const link = links?.[0];
  if (!link) return null;

  const { href, isFundraiser } = getHref(link, articlesPagePath, fundraisersPath);
  if (!isSafeHref(href)) return null;

  const openInNewTab = link._type === "link" && link.newtab;
  // Same as LinkComponent: external URLs skip next/link, which would rewrite their slashes
  const LinkElement = isAbsoluteUrl(href) ? "a" : Link;

  return (
    <div className={styles.wrapper}>
      <LinkElement
        // nosemgrep: typescript.react.security.audit.react-href-var.react-href-var -- href passed isSafeHref above, so it is an http(s), mailto or tel link or a path on this site
        href={href}
        prefetch={isFundraiser ? false : undefined}
        target={openInNewTab ? "_blank" : undefined}
        rel={openInNewTab ? "noopener noreferrer" : undefined}
        className={`${buttonStyles.button} ${buttonStyles.buttonprimary} ${styles.button}`}
        data-cy="standalone-button"
      >
        {link.title}
      </LinkElement>
    </div>
  );
};
