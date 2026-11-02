// Links typed by editors: only web, e-mail and phone links, or paths on this site.
// Anything else (javascript:, data:) is not rendered.
const safeSchemes = /^(https?:|mailto:|tel:)/i;

export const isSafeHref = (href: string): boolean => {
  const value = href.trim();
  if (value === "") return false;
  // A path on this site. "//" alone is the home page (its slug is "/"), but "//host"
  // and "/\host" would leave the site, since browsers read both as another host.
  if (value.startsWith("/")) return !/^\/[/\\][^/]/.test(value);
  return safeSchemes.test(value);
};
