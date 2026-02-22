import { memo, useMemo } from "react";
import type { Components } from "react-markdown";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";

import { useTheme } from "@/common";

import { type CustomEmojiEntry, preprocessCustomEmojis, remarkEmoji } from "../utils/remarkEmoji";

const UNICODE_EMOJI_RE = /\p{Extended_Pictographic}/u;

function isEmojiOnly(text: string): boolean {
  const stripped = text
    .replace(/:([a-zA-Z0-9_+-]+):/g, "")
    .replace(/\p{Extended_Pictographic}\uFE0F?/gu, "")
    .replace(/\u200D/g, "")
    .trim();
  return stripped.length === 0 && (UNICODE_EMOJI_RE.test(text) || /:([a-zA-Z0-9_+-]+):/.test(text));
}

const components: Components = {
  h1: ({ children }) => (
    <span style={{ fontSize: "1.4em", fontWeight: 700, display: "block", margin: "4px 0 2px" }}>
      {children}
    </span>
  ),
  h2: ({ children }) => (
    <span style={{ fontSize: "1.2em", fontWeight: 700, display: "block", margin: "4px 0 2px" }}>
      {children}
    </span>
  ),
  h3: ({ children }) => (
    <span style={{ fontSize: "1.1em", fontWeight: 600, display: "block", margin: "3px 0 1px" }}>
      {children}
    </span>
  ),
  p: ({ children }) => (
    <span style={{ display: "block", margin: "2px 0", lineHeight: 1.5 }}>{children}</span>
  ),
  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      style={{ color: "var(--accent-11)", textDecoration: "underline" }}
    >
      {children}
    </a>
  ),
  code: ({ className, children, ...props }) => {
    const isBlock = className?.includes("language-") || className?.includes("hljs");
    if (isBlock) {
      return (
        <code className={className} {...props} style={{ fontSize: "0.85em" }}>
          {children}
        </code>
      );
    }
    return (
      <code
        style={{
          background: "var(--gray-4)",
          padding: "1px 5px",
          borderRadius: "var(--radius-2)",
          fontSize: "0.85em",
          fontFamily: "var(--code-font-family)",
        }}
      >
        {children}
      </code>
    );
  },
  pre: ({ children }) => (
    <pre
      style={{
        background: "var(--gray-2)",
        border: "1px solid var(--gray-5)",
        borderRadius: "var(--radius-4)",
        padding: "10px 12px",
        margin: "4px 0",
        overflowX: "auto",
        fontSize: "0.85em",
        lineHeight: 1.5,
      }}
    >
      {children}
    </pre>
  ),
  blockquote: ({ children }) => (
    <blockquote
      style={{
        borderLeft: "3px solid var(--accent-9)",
        paddingLeft: "12px",
        margin: "4px 0",
        color: "var(--gray-11)",
      }}
    >
      {children}
    </blockquote>
  ),
  ul: ({ children }) => (
    <ul style={{ margin: "2px 0", paddingLeft: "20px" }}>{children}</ul>
  ),
  ol: ({ children }) => (
    <ol style={{ margin: "2px 0", paddingLeft: "20px" }}>{children}</ol>
  ),
  li: ({ children }) => (
    <li style={{ lineHeight: 1.5 }}>{children}</li>
  ),
  img: ({ src, alt, className, ...props }) => {
    const isCustomEmoji = className === "inline-emoji"
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      || (props as any)["data-emoji-name"]
      || (alt && /^:[a-zA-Z0-9_+-]+:$/.test(alt));
    if (isCustomEmoji) {
      return (
        <img
          src={src}
          alt={alt || ""}
          className="inline-emoji"
          style={{
            height: "1.4em",
            width: "1.4em",
            verticalAlign: "middle",
            display: "inline",
            objectFit: "contain",
            margin: "0 1px",
          }}
        />
      );
    }
    return (
      <img
        src={src}
        alt={alt || ""}
        style={{
          maxWidth: "100%",
          maxHeight: "300px",
          borderRadius: "var(--radius-4)",
          margin: "4px 0",
          display: "block",
          cursor: "pointer",
        }}
        onClick={() => src && window.open(src, "_blank")}
      />
    );
  },
  hr: () => (
    <hr style={{ border: "none", borderTop: "1px solid var(--gray-6)", margin: "6px 0" }} />
  ),
  table: ({ children }) => (
    <div style={{ overflowX: "auto", margin: "4px 0" }}>
      <table
        style={{
          borderCollapse: "collapse",
          fontSize: "0.9em",
          width: "100%",
        }}
      >
        {children}
      </table>
    </div>
  ),
  th: ({ children }) => (
    <th
      style={{
        border: "1px solid var(--gray-6)",
        padding: "4px 8px",
        background: "var(--gray-3)",
        fontWeight: 600,
        textAlign: "left",
      }}
    >
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td style={{ border: "1px solid var(--gray-6)", padding: "4px 8px" }}>{children}</td>
  ),
};

const remarkPlugins = [remarkGfm, remarkEmoji];
const rehypePlugins = [rehypeHighlight];

export const MarkdownRenderer = memo(({
  content,
  customEmojis,
}: {
  content: string | null;
  customEmojis?: CustomEmojiEntry[];
}) => {
  const { emojiSize } = useTheme();
  const emojiOnly = useMemo(() => content ? isEmojiOnly(content) : false, [content]);
  const processed = useMemo(
    () => content ? preprocessCustomEmojis(content, customEmojis ?? []) : null,
    [content, customEmojis],
  );

  if (!processed) return null;

  return (
    <div
      className={`markdown-message${emojiOnly ? " emoji-only" : ""}`}
      style={emojiOnly ? { "--emoji-only-size": `${emojiSize}px` } as React.CSSProperties : undefined}
    >
      <ReactMarkdown
        remarkPlugins={remarkPlugins}
        rehypePlugins={rehypePlugins}
        components={components}
      >
        {processed}
      </ReactMarkdown>
    </div>
  );
});

MarkdownRenderer.displayName = "MarkdownRenderer";
