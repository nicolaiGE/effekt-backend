import { stegaClean } from "@sanity/client/stega";

// One address only: no spaces, no second @ or recipient (, ;), and none of the
// characters that would add mailto parameters (?cc=, &body=) or change the scheme.
const emailPattern = /^[^\s@?&#:/<>",;]+@[^\s@?&#:/<>",;]+\.[^\s@?&#:/<>",;]+$/;

/** The mailto: link for the hero contact button, or undefined if the e-mail is not usable. */
export const contactHref = (email?: string | null): string | undefined => {
  // In draft mode Sanity adds invisible characters to strings, so clean them first.
  const address = stegaClean(email ?? "").trim();
  return emailPattern.test(address) ? `mailto:${address}` : undefined;
};
