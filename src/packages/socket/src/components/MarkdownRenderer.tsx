import { cloneElement, isValidElement, memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MdCheck, MdContentCopy } from "react-icons/md";
import type { Components } from "react-markdown";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";

import { getServerAccessToken, getServerHttpBase, useTheme } from "@/common";

import { type CustomEmojiEntry, preprocessCustomEmojis, remarkEmoji } from "../utils/remarkEmoji";
import { createRemarkMention } from "../utils/remarkMention";
import type { ProfanityMatchRange } from "./chatUtils";
import { MediaContextMenu } from "./MediaContextMenu";
import { BlurredWord } from "./ProfanityBlur";

type MarkdownImgProps = React.ImgHTMLAttributes<HTMLImageElement> & {
  node?: unknown;
  "data-emoji-name"?: string;
};

const markdownImageSizeCache = new Map<string, { width: number; height: number }>();

type RemoteImageMetadata = { width: number | null; height: number | null };

function parseRemoteImageMetadata(raw: unknown): RemoteImageMetadata | null {
  if (typeof raw !== "object" || raw === null) return null;
  const rec = raw as Record<string, unknown>;
  const width = typeof rec.width === "number" ? rec.width : null;
  const height = typeof rec.height === "number" ? rec.height : null;
  return { width, height };
}

const RemoteMarkdownImage = memo(({
  src,
  alt,
  serverHost,
  cacheKey,
  cached,
}: {
  src: string;
  alt: string;
  serverHost: string | null;
  cacheKey: string;
  cached: { width: number; height: number } | undefined;
}) => {
  const [size, setSize] = useState<{ width: number; height: number } | undefined>(cached);

  useEffect(() => {
    setSize(markdownImageSizeCache.get(cacheKey));
  }, [cacheKey]);

  useEffect(() => {
    if (size) return;
    if (!serverHost) return;
    const accessToken = getServerAccessToken(serverHost);
    if (!accessToken) return;
    const base = getServerHttpBase(serverHost);
    let cancelled = false;
    fetch(`${base}/api/media/metadata?url=${encodeURIComponent(src)}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("metadata_failed"))))
      .then((j: unknown) => {
        if (cancelled) return;
        const meta = parseRemoteImageMetadata(j);
        if (!meta?.width || !meta.height) return;
        const next = { width: meta.width, height: meta.height };
        markdownImageSizeCache.set(cacheKey, next);
        setSize(next);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [serverHost, size, cacheKey, src]);

  return (
    <MediaContextMenu src={src} isImage>
      <div className="markdown-image-wrap">
        <img
          src={src}
          alt={alt}
          className="markdown-image"
          width={size?.width}
          height={size?.height}
          loading="lazy"
          decoding="async"
          onLoad={(e) => {
            const img = e.currentTarget;
            if (img.naturalWidth > 0 && img.naturalHeight > 0) {
              const next = { width: img.naturalWidth, height: img.naturalHeight };
              markdownImageSizeCache.set(cacheKey, next);
              setSize(next);
            }
          }}
          onClick={() => window.open(src, "_blank")}
        />
      </div>
    </MediaContextMenu>
  );
});

RemoteMarkdownImage.displayName = "RemoteMarkdownImage";

const PROFANITY_START = "\uE000";
const PROFANITY_END = "\uE001";
const PROFANITY_RE = /\uE000([\s\S]*?)\uE001/g;

function insertProfanityMarkers(
  text: string,
  matches: ProfanityMatchRange[],
): string {
  if (matches.length === 0) return text;
  const sorted = [...matches].sort((a, b) => a.startIndex - b.startIndex);
  let result = "";
  let cursor = 0;
  for (const m of sorted) {
    const start = Math.max(0, m.startIndex);
    const end = Math.min(text.length, m.endIndex + 1);
    if (start < cursor) continue;
    result += text.slice(cursor, start);
    result += PROFANITY_START + text.slice(start, end) + PROFANITY_END;
    cursor = end;
  }
  result += text.slice(cursor);
  return result;
}

function processProfanityInChildren(node: React.ReactNode, keyPrefix = ""): React.ReactNode {
  if (typeof node === "string") {
    if (!node.includes(PROFANITY_START)) return node;
    const parts: React.ReactNode[] = [];
    let lastIndex = 0;
    let match: RegExpExecArray | null;
    PROFANITY_RE.lastIndex = 0;
    while ((match = PROFANITY_RE.exec(node)) !== null) {
      if (match.index > lastIndex) {
        parts.push(node.slice(lastIndex, match.index));
      }
      parts.push(<BlurredWord key={`${keyPrefix}b${match.index}`} word={match[1]} />);
      lastIndex = match.index + match[0].length;
    }
    if (lastIndex < node.length) parts.push(node.slice(lastIndex));
    return parts.length === 1 ? parts[0] : <>{parts}</>;
  }

  if (Array.isArray(node)) {
    return node.map((child, i) => processProfanityInChildren(child, `${keyPrefix}${i}-`));
  }

  if (isValidElement(node) && node.props && typeof (node.props as Record<string, unknown>).children !== "undefined") {
    const props = node.props as Record<string, unknown>;
    return cloneElement(
      node,
      {},
      processProfanityInChildren(props.children as React.ReactNode, `${keyPrefix}c-`),
    );
  }

  return node;
}

const UNICODE_EMOJI_RE = /\p{Extended_Pictographic}/u;

function isEmojiOnly(text: string): boolean {
  const stripped = text
    .replace(/:([a-zA-Z0-9_+-]+):/g, "")
    .replace(/\p{Extended_Pictographic}\uFE0F?/gu, "")
    .replace(/\u200D/g, "")
    .trim();
  return stripped.length === 0 && (UNICODE_EMOJI_RE.test(text) || /:([a-zA-Z0-9_+-]+):/.test(text));
}

function CodeBlockPre({ children }: { children: React.ReactNode }) {
  const [copied, setCopied] = useState(false);
  const preRef = useRef<HTMLPreElement>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleCopy = useCallback(() => {
    const text = preRef.current?.textContent ?? "";
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => setCopied(false), 2000);
    });
  }, []);

  return (
    <pre
      ref={preRef}
      style={{
        position: "relative",
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
      <button
        type="button"
        onClick={handleCopy}
        aria-label={copied ? "Copied" : "Copy code"}
        style={{
          position: "absolute",
          top: 6,
          right: 6,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: 26,
          height: 26,
          border: "none",
          borderRadius: "var(--radius-2)",
          background: copied ? "var(--green-4)" : "var(--gray-4)",
          color: copied ? "var(--green-11)" : "var(--gray-11)",
          cursor: "pointer",
          transition: "background 0.15s, color 0.15s",
        }}
      >
        {copied ? <MdCheck size={14} /> : <MdContentCopy size={14} />}
      </button>
      {children}
    </pre>
  );
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
  a: ({ href, children }) => {
    if (href === "mention:") {
      return (
        <span
          style={{
            color: "var(--accent-11)",
            fontWeight: 600,
            background: "var(--accent-a3)",
            borderRadius: "var(--radius-2)",
            padding: "0 2px",
          }}
        >
          {children}
        </span>
      );
    }
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        style={{ color: "var(--accent-11)", textDecoration: "underline" }}
      >
        {children}
      </a>
    );
  },
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
  pre: ({ children }) => <CodeBlockPre>{children}</CodeBlockPre>,
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
  img: ({ src, alt, className, ...props }: MarkdownImgProps) => {
    const isCustomEmoji = className === "inline-emoji"
      || Boolean(props["data-emoji-name"])
      || (alt && /^:[a-zA-Z0-9_+-]+:$/.test(alt));
    if (isCustomEmoji) {
      return (
        <img
          src={src}
          alt={alt || ""}
          className="inline-emoji"
          style={{
            height: "1.4em",
            width: "auto",
            verticalAlign: "middle",
            display: "inline",
            objectFit: "contain",
            margin: "0 1px",
          }}
        />
      );
    }

    const cacheKey = src ?? "";
    const cached = cacheKey ? markdownImageSizeCache.get(cacheKey) : undefined;

    return (
      <MediaContextMenu src={src || ""} isImage>
        <div className="markdown-image-wrap">
          <img
            src={src}
            alt={alt || ""}
            className="markdown-image"
            width={cached?.width}
            height={cached?.height}
            loading="lazy"
            decoding="async"
            onLoad={(e) => {
              const img = e.currentTarget;
              if (!cacheKey) return;
              if (img.naturalWidth > 0 && img.naturalHeight > 0) {
                markdownImageSizeCache.set(cacheKey, { width: img.naturalWidth, height: img.naturalHeight });
              }
            }}
            onClick={() => src && window.open(src, "_blank")}
          />
        </div>
      </MediaContextMenu>
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

const baseRemarkPlugins = [remarkGfm, remarkEmoji];
const rehypePlugins = [rehypeHighlight];

export const MarkdownRenderer = memo(({
  content,
  customEmojis,
  memberNicknames,
  mentionMembersById,
  serverHost,
  profanityMatches,
  blurProfanity,
}: {
  content: string | null;
  customEmojis?: CustomEmojiEntry[];
  memberNicknames?: string[];
  mentionMembersById?: Record<string, { nickname: string }>;
  serverHost?: string | null;
  profanityMatches?: ProfanityMatchRange[];
  blurProfanity?: boolean;
}) => {
  const { emojiSize } = useTheme();
  const emojiOnly = useMemo(() => content ? isEmojiOnly(content) : false, [content]);
  const hasProfanity = !!(blurProfanity && profanityMatches && profanityMatches.length > 0);

  const membersById = useMemo(() => {
    const m = new Map<string, string>();
    if (!mentionMembersById) return m;
    for (const [id, info] of Object.entries(mentionMembersById)) {
      if (info?.nickname) m.set(id, info.nickname);
    }
    return m;
  }, [mentionMembersById]);

  const markedContent = useMemo(() => {
    if (!content) return null;
    if (hasProfanity) return insertProfanityMarkers(content, profanityMatches!);
    return content;
  }, [content, hasProfanity, profanityMatches]);

  const processed = useMemo(
    () => markedContent ? preprocessCustomEmojis(markedContent, customEmojis ?? []) : null,
    [markedContent, customEmojis],
  );

  const remarkPlugins = useMemo(() => {
    if (mentionMembersById) {
      const members = Object.entries(mentionMembersById)
        .map(([serverUserId, m]) => ({ serverUserId, nickname: m.nickname }))
        .filter((m) => Boolean(m.nickname));
      if (members.length === 0) return baseRemarkPlugins;
      return [...baseRemarkPlugins, createRemarkMention(members)];
    }
    if (!memberNicknames || memberNicknames.length === 0) return baseRemarkPlugins;
    return [...baseRemarkPlugins, createRemarkMention(memberNicknames.map((n) => ({ serverUserId: n, nickname: n })))];
  }, [memberNicknames, mentionMembersById]);

  const activeComponents = useMemo(() => {
    const base: Components = {
      ...components,
      img: ({ src, alt, className, ...props }: MarkdownImgProps) => {
        const isCustomEmoji = className === "inline-emoji"
          || Boolean(props["data-emoji-name"])
          || (alt && /^:[a-zA-Z0-9_+-]+:$/.test(alt));
        if (isCustomEmoji) {
          return (
            <img
              src={src}
              alt={alt || ""}
              className="inline-emoji"
              style={{
                height: "1.4em",
                width: "auto",
                verticalAlign: "middle",
                display: "inline",
                objectFit: "contain",
                margin: "0 1px",
              }}
            />
          );
        }

        if (!src) return null;
        const cacheKey = src;
        const cached = markdownImageSizeCache.get(cacheKey);
        return (
          <RemoteMarkdownImage
            src={src}
            alt={alt || ""}
            serverHost={serverHost ?? null}
            cacheKey={cacheKey}
            cached={cached}
          />
        );
      },
      a: ({ href, children }) => {
        const mentionId = href?.startsWith("mention:") ? href.slice("mention:".length) : null;
        if (mentionId !== null) {
          const display = (() => {
            if (!mentionId) return children;
            const nick = membersById.get(mentionId);
            if (!nick) return children;
            return `@${nick}`;
          })();
          return (
            <span
              style={{
                color: "var(--accent-11)",
                fontWeight: 600,
                background: "var(--accent-a3)",
                borderRadius: "var(--radius-2)",
                padding: "0 2px",
                cursor: "default",
              }}
            >
              {display}
            </span>
          );
        }
        return (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: "var(--accent-11)", textDecoration: "underline" }}
          >
            {children}
          </a>
        );
      },
    };

    if (!hasProfanity) return base;
    const wrap = (Component: React.FC<{ children?: React.ReactNode }>) =>
      ({ children, ...rest }: { children?: React.ReactNode }) => (
        <Component {...rest}>{processProfanityInChildren(children)}</Component>
      );

    return {
      ...base,
      p: wrap(base.p as React.FC<{ children?: React.ReactNode }>),
      h1: wrap(base.h1 as React.FC<{ children?: React.ReactNode }>),
      h2: wrap(base.h2 as React.FC<{ children?: React.ReactNode }>),
      h3: wrap(base.h3 as React.FC<{ children?: React.ReactNode }>),
      li: wrap(base.li as React.FC<{ children?: React.ReactNode }>),
      td: wrap(base.td as React.FC<{ children?: React.ReactNode }>),
      th: wrap(base.th as React.FC<{ children?: React.ReactNode }>),
    } as Components;
  }, [hasProfanity, membersById, serverHost]);

  if (!processed) return null;

  return (
    <div
      className={`markdown-message${emojiOnly ? " emoji-only" : ""}`}
      style={emojiOnly ? { "--emoji-only-size": `${emojiSize}px` } as React.CSSProperties : undefined}
    >
      <ReactMarkdown
        remarkPlugins={remarkPlugins}
        rehypePlugins={rehypePlugins}
        components={activeComponents}
      >
        {processed}
      </ReactMarkdown>
    </div>
  );
});

MarkdownRenderer.displayName = "MarkdownRenderer";
