import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export interface MentionMember {
  nickname: string;
  serverUserId: string;
  avatarUrl?: string | null;
}

interface MentionAutocompleteProps {
  query: string;
  visible: boolean;
  members: MentionMember[];
  onSelect: (nickname: string) => void;
  onClose: () => void;
}

function filterMembers(members: MentionMember[], query: string): MentionMember[] {
  if (!query) return members.slice(0, 15);
  const q = query.toLowerCase();

  const prefixMatches: MentionMember[] = [];
  const substringMatches: MentionMember[] = [];

  for (const m of members) {
    const name = m.nickname.toLowerCase();
    if (name.startsWith(q)) {
      prefixMatches.push(m);
    } else if (name.includes(q)) {
      substringMatches.push(m);
    }
  }

  return [...prefixMatches, ...substringMatches].slice(0, 15);
}

export const MentionAutocomplete = ({ query, visible, members, onSelect, onClose }: MentionAutocompleteProps) => {
  const [results, setResults] = useState<MentionMember[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!visible) {
      setResults([]);
      setSelectedIndex(0);
      return;
    }
    setResults(filterMembers(members, query));
    setSelectedIndex(0);
  }, [query, visible, members]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!visible || results.length === 0) return;

      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((i) => (i + 1) % results.length);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((i) => (i - 1 + results.length) % results.length);
      } else if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        e.stopPropagation();
        onSelect(results[selectedIndex].nickname);
      } else if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    },
    [visible, results, selectedIndex, onSelect, onClose],
  );

  useEffect(() => {
    if (!visible) return;
    document.addEventListener("keydown", handleKeyDown, true);
    return () => document.removeEventListener("keydown", handleKeyDown, true);
  }, [visible, handleKeyDown]);

  useEffect(() => {
    const el = containerRef.current?.children[selectedIndex] as HTMLElement | undefined;
    el?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  const header = useMemo(() => {
    if (!query) return "Members";
    return null;
  }, [query]);

  if (!visible || results.length === 0) return null;

  return (
    <div
      ref={containerRef}
      className="mention-autocomplete"
      style={{
        position: "absolute",
        bottom: "100%",
        left: 0,
        right: 0,
        marginBottom: "4px",
        background: "var(--color-panel-solid)",
        border: "1px solid var(--gray-6)",
        borderRadius: "var(--radius-5)",
        boxShadow: "0 8px 24px rgba(0, 0, 0, 0.25)",
        maxHeight: "280px",
        overflowY: "auto",
        zIndex: 100,
        padding: "4px",
      }}
    >
      {header && (
        <div
          style={{
            padding: "4px 10px 2px",
            fontSize: "11px",
            fontWeight: 600,
            color: "var(--gray-9)",
            textTransform: "uppercase",
            letterSpacing: "0.5px",
            userSelect: "none",
          }}
        >
          {header}
        </div>
      )}
      {results.map((member, idx) => (
        <div
          key={member.serverUserId}
          onMouseDown={(e) => {
            e.preventDefault();
            onSelect(member.nickname);
          }}
          onMouseEnter={() => setSelectedIndex(idx)}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "10px",
            padding: "6px 10px",
            borderRadius: "var(--radius-3)",
            cursor: "pointer",
            background: idx === selectedIndex ? "var(--gray-4)" : "transparent",
            transition: "background 0.1s ease",
            fontSize: "14px",
          }}
        >
          <span
            style={{
              width: "24px",
              height: "24px",
              borderRadius: "50%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
              overflow: "hidden",
              background: "var(--accent-5)",
              color: "var(--accent-11)",
              fontSize: "12px",
              fontWeight: 600,
            }}
          >
            {member.avatarUrl ? (
              <img
                src={member.avatarUrl}
                alt={member.nickname}
                style={{ width: "24px", height: "24px", objectFit: "cover" }}
              />
            ) : (
              member.nickname[0]?.toUpperCase()
            )}
          </span>
          <span style={{ color: "var(--gray-12)", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {member.nickname}
          </span>
        </div>
      ))}
    </div>
  );
};
