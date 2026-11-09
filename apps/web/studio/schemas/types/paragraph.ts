import { defineType, defineField } from "sanity";
import { Type } from "react-feather";
import { blocktype } from "./blockcontent";
import { HEADING_LEVELS } from "../../headingLevels";

export default defineType({
  title: "Paragraph",
  name: "paragraph",
  type: "object",
  icon: Type,
  fields: [
    defineField({
      name: "title",
      title: "Title",
      type: "string",
    }),
    defineField({
      name: "heading_level",
      title: "Title level",
      type: "string",
      options: { list: [...HEADING_LEVELS], layout: "radio", direction: "horizontal" },
      description:
        "Looks the same either way. Choose a heading to put the title in the page outline for search engines and screen readers: h2 for a main section, h3 under it.",
    }),
    defineField({
      name: "content",
      title: "Content",
      type: "array",
      of: [blocktype, { type: "latex" }],
    }),
  ],
  preview: {
    select: {
      title: "title",
      subtitle: "content.0.children.0.text",
    },
    prepare({ title, subtitle }: { title: string; subtitle: string }) {
      return {
        title: title || " ",
        subtitle,
      };
    },
  },
});
