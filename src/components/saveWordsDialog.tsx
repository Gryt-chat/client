import { Button, Dialog } from "@gryt/ui";
import { useEffect, useState } from "react";

import { getIdentityWords, markWordsSaved, useAccount, wordsNeedSaving } from "@/common";

import { RecoveryWordsPanel } from "../packages/settings/src/components/recoveryWords";

const REMIND_AFTER = "gryt_words_remind_after";
const DAY_MS = 24 * 60 * 60 * 1000;

function snoozed(): boolean {
  try {
    return Number(localStorage.getItem(REMIND_AFTER) ?? 0) > Date.now();
  } catch {
    return false;
  }
}

/**
 * On the device that made your key: it's locked to your devices, and the 24 words are the
 * only way back if you lose them all. Asked once, with "remind me tomorrow".
 */
export function SaveWordsDialog() {
  const { isSignedIn } = useAccount();
  const [open, setOpen] = useState(false);
  const [words, setWords] = useState<string | null>(null);

  useEffect(() => {
    if (isSignedIn && wordsNeedSaving() && !snoozed()) setOpen(true);
  }, [isSignedIn]);

  const later = () => {
    try {
      localStorage.setItem(REMIND_AFTER, String(Date.now() + DAY_MS));
    } catch {
      // Then it asks again next launch.
    }
    setOpen(false);
  };
  const saved = () => {
    markWordsSaved();
    setOpen(false);
  };

  return (
    <Dialog.Root open={open} onOpenChange={(next) => { if (!next) later(); }}>
      <Dialog.Portal>
        <Dialog.Backdrop />
        <Dialog.Popup className="w-[30rem] max-w-[calc(100vw-2rem)] max-h-[calc(100dvh-2rem)] overflow-y-auto">
          <Dialog.Title>{words ? "Your 24 words" : "Your private messages are locked"}</Dialog.Title>
          <div className="mt-3 flex flex-col gap-3 text-sm">
            {words ? (
              <>
                <RecoveryWordsPanel
                  words={words}
                  note="This is your key, written out. Anyone with these words can read your messages, so keep them somewhere private."
                  copyLabel="Copy"
                  onHide={() => setWords(null)}
                />
                <div className="flex flex-wrap gap-2">
                  <Button onClick={saved}>I&rsquo;ve saved them</Button>
                </div>
                <span className="text-xs text-gryt-muted">You can find them again any time in Settings, under Your devices.</span>
              </>
            ) : (
              <>
                <p>
                  Gryt made a key for you on this device. Only your devices can open your DMs, not us and not the
                  server. Your other devices get the key when you approve them.
                </p>
                <p>One more step: save your 24 words. They&rsquo;re the only way back if you ever lose every device.</p>
                <div className="flex flex-wrap gap-2">
                  <Button onClick={() => void getIdentityWords().then(setWords)}>Save my 24 words</Button>
                  <Button tone="ghost" onClick={later}>Remind me tomorrow</Button>
                </div>
              </>
            )}
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
