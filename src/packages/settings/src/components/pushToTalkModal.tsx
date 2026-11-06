import { Button, Chip, Dialog } from "@gryt/ui";
import { useCallback, useEffect, useState } from "react";

import { useSettings } from "@/settings";

import { buildKeyCombo, buildMouseCombo, formatCombo } from "../../../../lib/hotkeys";
import { useLocale } from "../../../../lib/localeContext";

export function PushToTalkModal() {
  const { t } = useLocale();
  const { inputMode, setInputMode, pushToTalkKey, setPushToTalkKey } = useSettings();
  const isOpen = inputMode === "push_to_talk" && !pushToTalkKey;

  const [captured, setCaptured] = useState("");

  useEffect(() => {
    if (isOpen) setCaptured("");
  }, [isOpen]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.code === "Escape") return;
      const combo = buildKeyCombo(e);
      if (combo) setCaptured(combo);
    },
    [],
  );

  // Left and right click stay clicks, so the Confirm button still works.
  const handleMouseDown = useCallback((e: MouseEvent) => {
    const combo = buildMouseCombo(e);
    if (!combo) return;
    e.preventDefault();
    e.stopPropagation();
    setCaptured(combo);
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    window.addEventListener("keydown", handleKeyDown, true);
    window.addEventListener("mousedown", handleMouseDown, true);
    return () => {
      window.removeEventListener("keydown", handleKeyDown, true);
      window.removeEventListener("mousedown", handleMouseDown, true);
    };
  }, [isOpen, handleKeyDown, handleMouseDown]);

  const handleConfirm = () => {
    if (captured) {
      setPushToTalkKey(captured);
    }
  };

  const handleCancel = () => {
    setCaptured("");
    setInputMode("voice_activity");
  };

  return (
    <Dialog.Root open={isOpen} onOpenChange={(open) => { if (!open) handleCancel(); }}>
      <Dialog.Portal>
        <Dialog.Backdrop />
        <Dialog.Popup>
        <Dialog.Title>{t("settings.bindPushToTalk")}</Dialog.Title>
        <Dialog.Description>
          {t("settings.pushToTalkIsOnButNothingIsBoundTo")}
        </Dialog.Description>

        <div className="flex flex-col gap-4 items-center py-4">
          <Chip tone="neutral"
            color={captured ? "green" : "blue"}
            style={{ fontFamily: "var(--code-font-family)", minWidth: "120px", textAlign: "center", padding: "8px 16px", fontSize: 16 }}
          >
            {captured ? formatCombo(captured) : t("settings.pressAKeyOrButton")}
          </Chip>

          {captured && (
            <span className="text-xs text-gryt-muted">
              {t("settings.pressSomethingElseToChangeItOrConfirmBelow")}
            </span>
          )}
        </div>

        <div className="flex flex-wrap gap-3 justify-end">
          <Button tone="neutral" size="small" onClick={handleCancel}>
            {t("common.cancel")}
          </Button>
          <Button size="small" onClick={handleConfirm} disabled={!captured}>
            {t("settings.confirm")}
          </Button>
        </div>
      </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
