import React, { createElement, useEffect } from "react";
import elements from "./Paragraph.module.scss";
import { PortableText } from "@portabletext/react";
import { stegaClean } from "@sanity/client/stega";
import { customComponentRenderers, observeCitationLayout, reflowCitations } from "./Citation";
import { headingTag } from "../../../../studio/headingLevels";

export type ParagraphProps = {
  tocKey: string;
  title: string;
  /** h2 or h3 puts the title in the page outline. Without it the title is a paragraph */
  titleLevel?: string;
  blocks: any[];
};

export const Paragraph: React.FC<ParagraphProps> = ({ title, titleLevel, tocKey, blocks }) => {
  useEffect(observeCitationLayout, []);
  useEffect(() => {
    reflowCitations();
  }, [blocks]);

  return (
    <div className={elements.paragraphwrapper}>
      {createElement(
        headingTag(stegaClean(titleLevel)),
        { className: "inngress", "data-toc-key": tocKey },
        title,
      )}
      <PortableText value={blocks || []} components={customComponentRenderers}></PortableText>
    </div>
  );
};
