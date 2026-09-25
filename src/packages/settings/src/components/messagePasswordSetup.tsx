import { Alert, Button, Checkbox, TextField } from "@gryt/ui";
import { type ReactNode, useCallback, useMemo, useState } from "react";
import toast from "react-hot-toast";

import {
  describePasswordProblem,
  formatRecoveryKey,
  generateRecoveryKey,
  generateVaultPassword,
} from "@/common";

/**
 * Choosing the message password, with the warning decision 2 of the design asks for at
 * this moment. Six words by default, a recovery key offered and skippable (GRYT-1473).
 */
export interface MessagePasswordChoice {
  password: string;
  recoveryKey?: Uint8Array;
}

interface Props {
  submitLabel: string;
  busy: boolean;
  /** Said when a recovery key already exists, because sealing again replaces it. */
  replacesRecoveryKey?: boolean;
  /** Anything the caller needs above the password, like the reset's typed phrase. */
  children?: ReactNode;
  tone?: "danger";
  onSubmit(choice: MessagePasswordChoice): void;
  onCancel(): void;
}

const copy = (text: string, what: string) =>
  navigator.clipboard.writeText(text).then(
    () => toast.success(`${what} copied.`),
    () => toast.error("Couldn’t copy. Select it and copy it by hand."),
  );

export function MessagePasswordSetup({
  submitLabel,
  busy,
  replacesRecoveryKey,
  children,
  tone,
  onSubmit,
  onCancel,
}: Props) {
  const [words, setWords] = useState(() => generateVaultPassword());
  const [typing, setTyping] = useState(false);
  const [typed, setTyped] = useState("");
  const [again, setAgain] = useState("");
  const recoveryKey = useMemo(() => generateRecoveryKey(), []);
  const [skipRecovery, setSkipRecovery] = useState(false);
  const [saved, setSaved] = useState(false);

  const submit = useCallback(() => {
    let password = words;
    if (typing) {
      const problem = describePasswordProblem(typed);
      if (problem) return void toast.error(problem);
      if (typed !== again) return void toast.error("The two passwords don’t match.");
      password = typed;
    }
    if (!saved) return void toast.error("Tick the box once you’ve saved them.");
    onSubmit({ password, recoveryKey: skipRecovery ? undefined : recoveryKey });
  }, [words, typing, typed, again, saved, skipRecovery, recoveryKey, onSubmit]);

  const shownKey = formatRecoveryKey(recoveryKey);
  const mono = { fontFamily: "var(--gryt-font-mono, monospace)", userSelect: "all" as const };

  return (
    <div className="flex flex-col gap-3">
      <Alert severity="warning">
        This password is the only way to open your messages on a new device. Gryt
        can&rsquo;t reset it, can&rsquo;t recover it, and can&rsquo;t read your
        messages without it. If you lose it and have no other device signed in and
        no recovery key, every message you&rsquo;ve already received stays locked
        for good.
      </Alert>

      {children}

      {!typing ? (
        <div className="flex flex-col gap-2">
          <span className="font-medium text-sm">Your message password</span>
          <code className="text-sm" style={mono} data-testid="message-password-words">
            {words}
          </code>
          <div className="flex gap-2 flex-wrap">
            <Button size="small" tone="neutral" onClick={() => void copy(words, "Password")}>
              Copy
            </Button>
            <Button size="small" tone="neutral" onClick={() => setWords(generateVaultPassword())}>
              New words
            </Button>
            <Button size="small" tone="ghost" onClick={() => setTyping(true)}>
              Type my own instead
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <TextField
            type="password"
            label="Message password"
            autoComplete="new-password"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            helperText="At least 12 characters. A 12-character password somebody made up takes one graphics card about a year to guess, and 10,000 of them about an hour. Six generated words would take billions of years."
          />
          <TextField
            type="password"
            label="Again"
            autoComplete="new-password"
            value={again}
            onChange={(e) => setAgain(e.target.value)}
          />
          <div>
            <Button size="small" tone="ghost" onClick={() => setTyping(false)}>
              Use six words instead
            </Button>
          </div>
        </div>
      )}

      {!skipRecovery ? (
        <div className="flex flex-col gap-2">
          <span className="font-medium text-sm">Recovery key</span>
          <span className="text-xs text-gryt-muted">
            If you lose the password, this opens your messages on its own. You only
            see it once, here.
          </span>
          <code className="text-sm" style={mono} data-testid="message-recovery-key">
            {shownKey}
          </code>
          <div className="flex gap-2 flex-wrap">
            <Button size="small" tone="neutral" onClick={() => void copy(shownKey, "Recovery key")}>
              Copy
            </Button>
            <Button size="small" tone="ghost" onClick={() => setSkipRecovery(true)}>
              Skip it
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-gryt-muted">
            No recovery key. If you lose the password and every signed-in device,
            your messages are gone.
          </span>
          <Button size="small" tone="ghost" onClick={() => setSkipRecovery(false)}>
            Add one after all
          </Button>
        </div>
      )}

      {replacesRecoveryKey && (
        <span className="text-xs text-gryt-muted">
          This also replaces your recovery key. The old one stops working.
        </span>
      )}

      <span className="text-xs text-gryt-muted">
        A password manager is a good place to keep {skipRecovery ? "it" : "both"}.
      </span>

      <label className="flex cursor-pointer items-start gap-2 text-xs">
        <Checkbox checked={saved} onCheckedChange={(v) => setSaved(v === true)} />
        <span>
          {skipRecovery
            ? "I’ve saved the password somewhere I won’t lose it"
            : "I’ve saved them somewhere I won’t lose them"}
        </span>
      </label>

      <div className="flex gap-2">
        <Button size="small" tone={tone} onClick={submit} disabled={busy}>
          {busy ? "Working…" : submitLabel}
        </Button>
        <Button tone="neutral" size="small" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
