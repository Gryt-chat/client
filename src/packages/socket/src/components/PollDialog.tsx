import { Button, Dialog, IconButton, Switch, TextField } from "@gryt/ui";
import { useEffect, useState } from "react";

import { PiChartBarFill, PiDotsSixVerticalFill, PiX } from "../../../../lib/icons";
import { useServerPermissions } from "../hooks/usePermissions";
import { type NewPoll, POLL_DURATIONS, POLL_OPTION_MAX, POLL_OPTIONS_MAX, POLL_QUESTION_MAX } from "../utils/polls";

interface PollDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  serverHost: string | undefined;
  onPost: (poll: NewPoll) => void;
}

const DEFAULT_DURATION = POLL_DURATIONS[1].seconds;

/** + → Poll in the composer (GRYT-1732): a question, 2 to 10 options, and who may answer. */
export function PollDialog({ open, onOpenChange, serverHost, onPost }: PollDialogProps) {
  const { roles } = useServerPermissions(serverHost ?? "");
  const [question, setQuestion] = useState("");
  const [options, setOptions] = useState<string[]>(["", ""]);
  const [multi, setMulti] = useState(false);
  const [anonymous, setAnonymous] = useState(false);
  const [duration, setDuration] = useState<number | null>(DEFAULT_DURATION);
  const [limitRoles, setLimitRoles] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [dragFrom, setDragFrom] = useState<number | null>(null);

  useEffect(() => {
    if (!open) return;
    setQuestion("");
    setOptions(["", ""]);
    setMulti(false);
    setAnonymous(false);
    setDuration(DEFAULT_DURATION);
    setLimitRoles(false);
    setPicked([]);
  }, [open]);

  const filled = options.map((o) => o.trim()).filter(Boolean);
  const repeated = new Set(filled.map((o) => o.toLowerCase())).size !== filled.length;
  const canPost = question.trim().length > 0 && filled.length >= 2 && !repeated && (!limitRoles || picked.length > 0);

  // One empty row stays at the end to type into, up to the limit.
  const setOption = (i: number, value: string) => {
    setOptions((prev) => {
      const next = prev.map((o, j) => (j === i ? value : o));
      const empties = next.filter((o) => !o.trim()).length;
      if (empties === 0 && next.length < POLL_OPTIONS_MAX) next.push("");
      return next;
    });
  };
  const removeOption = (i: number) => setOptions((prev) => {
    const next = prev.filter((_, j) => j !== i);
    while (next.length < 2) next.push("");
    return next;
  });
  const move = (from: number, to: number) => setOptions((prev) => {
    const next = prev.slice();
    const [it] = next.splice(from, 1);
    next.splice(to, 0, it);
    return next;
  });

  const post = () => {
    if (!canPost) return;
    onPost({
      question: question.trim(),
      options: filled,
      multi,
      anonymous,
      ends_in_seconds: duration,
      allowed_roles: limitRoles ? picked : null,
    });
    onOpenChange(false);
  };

  const pickable = roles.filter((r) => r.id !== "owner");

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop />
        <Dialog.Popup>
          <div className="poll-dialog">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="poll-dialog-icon"><PiChartBarFill size={18} /></span>
                <Dialog.Title style={{ margin: 0 }}>New poll</Dialog.Title>
              </div>
              <Dialog.Close>
                <IconButton size="xsmall" aria-label="Close"><PiX size={16} /></IconButton>
              </Dialog.Close>
            </div>

            <label className="poll-dialog-field">
              <span className="poll-dialog-label">Question</span>
              <TextField
                value={question}
                maxLength={POLL_QUESTION_MAX}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder="What are we playing Friday?"
                autoFocus
              />
            </label>

            <div className="poll-dialog-field">
              <span className="poll-dialog-label">Options</span>
              {options.map((o, i) => (
                <div
                  key={i}
                  className="poll-dialog-option"
                  data-dragging={dragFrom === i || undefined}
                  onDragOver={(e) => { if (dragFrom !== null) e.preventDefault(); }}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (dragFrom !== null && dragFrom !== i) move(dragFrom, i);
                    setDragFrom(null);
                  }}
                >
                  <span
                    className="poll-dialog-grip"
                    draggable
                    aria-hidden="true"
                    onDragStart={(e) => { setDragFrom(i); e.dataTransfer.effectAllowed = "move"; }}
                    onDragEnd={() => setDragFrom(null)}
                  >
                    <PiDotsSixVerticalFill size={16} />
                  </span>
                  <input
                    className="poll-dialog-input"
                    value={o}
                    maxLength={POLL_OPTION_MAX}
                    placeholder={i < 2 ? `Option ${i + 1}` : "Add an option"}
                    aria-label={`Option ${i + 1}`}
                    onChange={(e) => setOption(i, e.target.value)}
                  />
                  {o.trim() && (
                    <IconButton size="xsmall" tone="ghost" aria-label={`Remove option ${i + 1}`} onClick={() => removeOption(i)}>
                      <PiX size={14} />
                    </IconButton>
                  )}
                </div>
              ))}
              {repeated && <span className="poll-dialog-hint" data-error>Two of the options are the same.</span>}
            </div>

            <label className="poll-dialog-toggle">
              <span className="flex flex-col">
                <span>Allow more than one answer</span>
                <span className="poll-dialog-hint">People can pick several options.</span>
              </span>
              <Switch checked={multi} onCheckedChange={setMulti} />
            </label>

            <label className="poll-dialog-toggle">
              <span className="flex flex-col">
                <span>Anonymous</span>
                <span className="poll-dialog-hint">Nobody sees who voted for what, only the totals.</span>
              </span>
              <Switch checked={anonymous} onCheckedChange={setAnonymous} />
            </label>

            <label className="poll-dialog-toggle">
              <span className="flex flex-col">
                <span>Only some roles can answer</span>
                <span className="poll-dialog-hint">Everyone else sees the results.</span>
              </span>
              <Switch checked={limitRoles} onCheckedChange={setLimitRoles} />
            </label>
            {limitRoles && (
              <div className="poll-dialog-pills" role="group" aria-label="Roles that can answer">
                {pickable.map((r) => {
                  const on = picked.includes(r.id);
                  return (
                    <button
                      key={r.id}
                      type="button"
                      className="poll-dialog-pill"
                      aria-pressed={on}
                      onClick={() => setPicked((prev) => (on ? prev.filter((x) => x !== r.id) : [...prev, r.id]))}
                    >
                      {r.color && <span className="poll-dialog-swatch" style={{ background: r.color }} />}
                      {r.name}
                    </button>
                  );
                })}
              </div>
            )}

            <div className="poll-dialog-field">
              <span className="poll-dialog-label">Ends</span>
              <div className="poll-dialog-pills" role="radiogroup" aria-label="Ends">
                {POLL_DURATIONS.map((d) => (
                  <button
                    key={d.label}
                    type="button"
                    role="radio"
                    className="poll-dialog-pill"
                    aria-checked={duration === d.seconds}
                    onClick={() => setDuration(d.seconds)}
                  >
                    {d.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex justify-end gap-2" style={{ marginTop: 4 }}>
              <Button tone="neutral" size="small" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button size="small" onClick={post} disabled={!canPost}>Post poll</Button>
            </div>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
