/** The elements an editor can choose for a paragraph title (field heading_level) */
export const HEADING_LEVELS = [
  { title: "Paragraph (as before)", value: "p" },
  { title: "Heading 2 (h2)", value: "h2" },
  { title: "Heading 3 (h3)", value: "h3" },
] as const;

export type HeadingLevel = (typeof HEADING_LEVELS)[number]["value"];

/**
 * The element to render a paragraph title with. Anything not set or not in the list is a
 * paragraph, which is how every title rendered before editors could choose.
 */
export const headingTag = (level: string | null | undefined): HeadingLevel =>
  HEADING_LEVELS.find((option) => option.value === level)?.value ?? "p";
