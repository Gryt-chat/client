import { useState } from "react";

export interface ForumTagDraft {
  id: string;
  name: string;
  emoji?: string | null;
  color?: string | null;
}

/**
 * A forum's tag palette, edited as chips. Shared by the create dialog and the
 * channel edit dialog, so tags can be set when a forum is made and changed
 * afterwards. GRYT-981 Stage 3.
 */

function slugifyTag(name: string): string {
  return (
    name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) ||
    `tag-${Math.random().toString(36).slice(2, 8)}`
  );
}

export function ForumTagsField({
  tags,
  onChange,
}: {
  tags: ForumTagDraft[];
  onChange: (next: ForumTagDraft[]) => void;
}) {
  const [draft, setDraft] = useState("");

  const add = () => {
    const name = draft.trim().slice(0, 40);
    if (!name) return;
    const id = slugifyTag(name);
    if (tags.some((t) => t.id === id) || tags.length >= 40) {
      setDraft("");
      return;
    }
    onChange([...tags, { id, name }]);
    setDraft("");
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div
        style={{
          display: "flex", flexWrap: "wrap", gap: 7, alignItems: "center",
          background: "var(--gryt-neutral-3)", border: "1px solid var(--gryt-neutral-6)",
          borderRadius: "var(--gryt-radius-sm)", padding: "8px 10px",
        }}
      >
        {tags.map((t) => (
          <span
            key={t.id}
            style={{
              display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 600,
              padding: "3px 6px 3px 10px", borderRadius: "var(--gryt-radius-full)",
              background: "var(--gryt-neutral-4)", color: "var(--gryt-neutral-11)",
              border: "1px solid var(--gryt-neutral-6)",
            }}
          >
            {t.name}
            <button
              type="button"
              onClick={() => onChange(tags.filter((x) => x.id !== t.id))}
              aria-label={`Remove ${t.name}`}
              style={{ background: "none", border: "none", color: "var(--gryt-neutral-10)", cursor: "pointer", fontSize: 14, lineHeight: 1, padding: 0 }}
            >
              ×
            </button>
          </span>
        ))}
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault();
              add();
            } else if (e.key === "Backspace" && !draft && tags.length > 0) {
              onChange(tags.slice(0, -1));
            }
          }}
          onBlur={add}
          placeholder={tags.length ? "Add another…" : "Linux, macOS, Voice…"}
          style={{ flex: 1, minWidth: 120, background: "transparent", border: "none", outline: "none", color: "var(--gryt-neutral-12)", fontSize: 14, fontFamily: "inherit" }}
        />
      </div>
      <span style={{ fontSize: 11.5, color: "var(--gryt-neutral-10)" }}>
        Press Enter to add a tag. People pick from these when they post a topic.
      </span>
    </div>
  );
}
