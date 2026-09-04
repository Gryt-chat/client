import type { GrytAppearance, GrytTheme } from "@gryt/ui";
import {
  Alert,
  Button,
  Chip,
  createGrytTheme,
  decodeGrytTheme,
  Dialog,
  GrytProvider,
  grytThemeToOptions,
  MessageBubble,
  Switch,
  TextField,
} from "@gryt/ui";
import { useState } from "react";

import { useCustomThemes, useTheme } from "@/common";

const GENERATOR = "https://ui.gryt.chat/theme/generator";

/**
 * Take a theme somebody sent you.
 *
 * The whole exchange is a link. Build a theme on ui.gryt.chat, press Copy link,
 * paste it here — the same parser reads it in both places, so there is no
 * second definition of the format to fall behind.
 *
 * Nothing is saved until it has been looked at. A theme is a couple of dozen
 * hex values and reading them tells you nothing.
 */
export function ImportThemeDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { saveTheme } = useCustomThemes();
  const { resolvedAppearance } = useTheme();

  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [incoming, setIncoming] = useState<GrytTheme | null>(null);
  const [name, setName] = useState("");
  // What the sender was looking at, which is worth previewing even when this
  // app is in the other one — a theme that was designed light and only ever
  // seen dark is the case this catches.
  const [preview, setPreview] = useState<GrytAppearance>(resolvedAppearance);

  function reset() {
    setInput("");
    setError(null);
    setIncoming(null);
    setName("");
  }

  function read(text: string) {
    const decoded = decodeGrytTheme(text);
    if (decoded === null) {
      setIncoming(null);
      setError(
        text.trim().startsWith("{")
          ? "There is no theme in that JSON."
          : "There is no theme in that link. Copy it from the generator with Copy link.",
      );
      return;
    }
    setIncoming(decoded.theme);
    setPreview(decoded.appearance);
    setError(null);
    // Whoever built it named it, and the name rides in the link. Asking again
    // would be asking a question that has already been answered — so the field
    // is filled in and stays editable, rather than being one more thing to
    // type before this is allowed to be saved.
    setName(decoded.theme.name ?? "Imported theme");
  }

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) reset();
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop />
        <Dialog.Popup className="max-w-[560px]">
          <Dialog.Title>Import a theme</Dialog.Title>
          <Dialog.Description>
            Paste a link from the theme generator, or the JSON it exports.
          </Dialog.Description>

          <div className="mt-4 flex flex-col gap-3">
            <TextField
              aria-label="Theme link or JSON"
              multiline
              minRows={2}
              placeholder={`${GENERATOR}?accent=…`}
              spellCheck={false}
              value={input}
              onChange={(event) => {
                setInput(event.target.value);
                setError(null);
              }}
            />

            <div className="flex items-center gap-3">
              <Button
                size="small"
                disabled={input.trim() === ""}
                onClick={() => read(input)}
              >
                Read it
              </Button>
              <a
                className="text-xs text-gryt-accent-11 hover:underline"
                href={GENERATOR}
                rel="noreferrer"
                target="_blank"
              >
                Build one on ui.gryt.chat
              </a>
            </div>

            {error ? <Alert severity="error">{error}</Alert> : null}

            {incoming ? (
              <>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-medium">Preview</span>
                  <label className="flex items-center gap-2 text-xs text-gryt-muted">
                    Light
                    <Switch
                      checked={preview === "light"}
                      onCheckedChange={(next) =>
                        setPreview(next ? "light" : "dark")
                      }
                    />
                  </label>
                </div>

                <ThemePreview appearance={preview} theme={incoming} />

                <TextField
                  label="Name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Imported theme"
                />
              </>
            ) : null}
          </div>

          <Dialog.Footer className="justify-between">
            <Dialog.Close render={<span />}>
              <Button size="small" tone="ghost">
                Cancel
              </Button>
            </Dialog.Close>
            <Button
              size="small"
              disabled={incoming === null}
              onClick={() => {
                if (incoming === null) return;
                saveTheme(name, incoming);
                onOpenChange(false);
                reset();
              }}
            >
              Save and use it
            </Button>
          </Dialog.Footer>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/**
 * The theme, on things that are actually in the app.
 *
 * Swatches would be smaller and would not answer the question. What people want
 * to know before they keep a theme is whether a message is readable in it and
 * whether the buttons still look like buttons.
 */
function ThemePreview({
  theme,
  appearance,
}: {
  theme: GrytTheme;
  appearance: GrytAppearance;
}) {
  return (
    <GrytProvider
      className="rounded-(--gryt-radius-lg) border border-gryt-border bg-gryt-bg p-4"
      theme={createGrytTheme(grytThemeToOptions(theme, appearance))}
    >
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button size="small">Join</Button>
          <Button size="small" tone="secondary">
            Invite
          </Button>
          <Button size="small" tone="neutral">
            Cancel
          </Button>
          <Button size="small" tone="danger">
            Leave
          </Button>
          <Chip label="3" tone="danger" />
        </div>

        <MessageBubble from="assistant">
          The SFU is dropping its second rebroadcast layer on Firefox again.
        </MessageBubble>
        <MessageBubble from="user">
          Only on the 4-person calls, which is why nobody noticed.
        </MessageBubble>

        <p className="m-0 text-xs text-gryt-muted">
          Muted text, on the page it will sit on.
        </p>
      </div>
    </GrytProvider>
  );
}
