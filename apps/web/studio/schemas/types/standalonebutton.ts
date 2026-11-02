import { defineType, defineField } from "sanity";
import { MousePointer } from "react-feather";

export default defineType({
  name: "standalonebutton",
  type: "document",
  title: "Button",
  icon: MousePointer,
  fields: [
    defineField({
      name: "links",
      type: "array",
      title: "Link",
      description: "A link to an external page, or a navigation item for a page on this site",
      of: [{ type: "link" }, { type: "navitem" }],
      validation: (rule) =>
        rule.required().length(1).error("Add exactly one link or navigation item"),
    }),
  ],
  preview: {
    select: {
      title: "links.0.title",
    },
    prepare: ({ title }) => ({
      title: title || "Button",
      subtitle: "Button",
    }),
  },
});
