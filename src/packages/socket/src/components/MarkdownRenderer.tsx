import { memo, useMemo } from "react";
import type { Components } from "react-markdown";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";

import { type CustomEmojiEntry,remarkEmoji } from "../utils/remarkEmoji";

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
          borderRadius: "4px",
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
        borderRadius: "8px",
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (className === "inline-emoji" || (props as any)["data-emoji-name"]) {
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
          borderRadius: "8px",
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

export const MarkdownRenderer = memo(({
  content,
  customEmojis,
}: {
  content: string | null;
  customEmojis?: CustomEmojiEntry[];
}) => {
  const emojiPlugin = useMemo(() => remarkEmoji(customEmojis), [customEmojis]);

  if (!content) return null;

  return (
    <div className="markdown-message">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, emojiPlugin]}
        rehypePlugins={[rehypeHighlight]}
        components={components}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
});

MarkdownRenderer.displayName = "MarkdownRenderer";
