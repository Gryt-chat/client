import { Button } from "@gryt/ui";
import { useEffect } from "react";
import toast from "react-hot-toast";

import { useGameDetection } from "../packages/settings/src/hooks/useGameDetection";
import { GameIcon } from "../packages/socket/src/components/GameIcon";

const toastId = (appId: string) => `game-detect-${appId}`;

/**
 * One toast per game Gryt spotted and hasn't asked about. It stays until answered,
 * even after the game closes, and nothing shows on the card before a yes.
 */
export function GameDetectPrompt() {
  const { pending, answer } = useGameDetection();

  useEffect(() => {
    for (const game of pending) {
      const name = game.name ?? "A game";
      toast(
        () => (
          <div className="flex flex-col gap-2" style={{ minWidth: 0 }}>
            <span className="flex items-center gap-2 text-sm font-medium">
              <GameIcon appId={game.id} name={name} size={20} />
              Show {name} on your card?
            </span>
            <span className="text-xs text-gryt-muted" style={{ lineHeight: 1.5 }}>
              Gryt spotted it. People on your servers see it on your card while it&rsquo;s on.
            </span>
            <div className="flex gap-2 justify-end">
              <Button tone="ghost" size="xsmall" onClick={() => void answer(game.id, "hide")}>
                Not this one
              </Button>
              <Button size="xsmall" onClick={() => void answer(game.id, "show")}>
                Show it
              </Button>
            </div>
          </div>
        ),
        { id: toastId(game.id), duration: Infinity },
      );
    }
    return () => {
      for (const game of pending) toast.dismiss(toastId(game.id));
    };
  }, [pending, answer]);

  return null;
}
