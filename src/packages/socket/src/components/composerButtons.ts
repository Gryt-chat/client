import { PiCode, PiLinkSimpleBold, PiListBulletsBold, PiListNumbersBold, PiQuotesBold, PiTextBBold, PiTextHOneBold, PiTextHThreeBold, PiTextHTwoBold, PiTextItalicBold, PiTextStrikethroughBold } from "../../../../lib/icons";

export type ComposerFormat = "bold" | "italic" | "strike" | "code" | "link" | "h1" | "h2" | "h3" | "list" | "olist" | "quote";

export const MASS_MENTION = /(^|\s)@(everyone|here)\b/;

export type FormatButton = { format: ComposerFormat; label: string; Icon: typeof PiCode };

/** In groups, with a gap between, so text styles, code and links, headings and blocks read apart. */
export const FORMAT_GROUPS: FormatButton[][] = [
  [
    { format: "bold", label: "Bold (Ctrl+B)", Icon: PiTextBBold },
    { format: "italic", label: "Italic (Ctrl+I)", Icon: PiTextItalicBold },
    { format: "strike", label: "Strikethrough (Ctrl+Shift+X)", Icon: PiTextStrikethroughBold },
  ],
  [
    { format: "code", label: "Code", Icon: PiCode },
    { format: "link", label: "Link", Icon: PiLinkSimpleBold },
  ],
  [
    { format: "h1", label: "Heading 1", Icon: PiTextHOneBold },
    { format: "h2", label: "Heading 2", Icon: PiTextHTwoBold },
    { format: "h3", label: "Heading 3", Icon: PiTextHThreeBold },
  ],
  [
    { format: "list", label: "Bullet list", Icon: PiListBulletsBold },
    { format: "olist", label: "Numbered list", Icon: PiListNumbersBold },
    { format: "quote", label: "Quote", Icon: PiQuotesBold },
  ],
];
