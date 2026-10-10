import { Slider } from "@gryt/ui";

import { useTheme } from "@/common";
import { useTranslation } from "@/i18n";

import { SettingsContainer } from "../settingsComponents";

/**
 * How big everything is drawn. Split out of the theme panel, which had grown to
 * hold the mode, the palette, three sizes and the voice grid.
 */
export function DisplaySettings() {
  const { t: tr } = useTranslation();
  const {
    emojiSize,
    setEmojiSize,
    chatFontSize,
    setChatFontSize,
    uiScale,
    setUiScale,
    resetZoom,
  } = useTheme();

  return (
    <SettingsContainer>
      <h2 className="text-lg">{tr("ui.display")}</h2>

      <div className="flex flex-col gap-2" id="ui-scale" data-setting="ui-scale">
        <div className="flex justify-between items-center">
          <span className="font-medium text-sm">{tr("ui.uiScale")}</span>
          <span className="text-xs text-gryt-muted">{Math.round(uiScale * 100)}%</span>
        </div>
        <Slider
          min={50}
          max={200}
          step={10}
          value={Math.round(uiScale * 100)}
          onValueChange={(next) => setUiScale(Number(next) / 100)}
        />
        <span className="text-xs text-gryt-muted">
          {tr("ui.ctrlPlusCtrlMinusToZoomCtrl0")}
        </span>
        {uiScale !== 1 && (
          <span className="text-xs" style={{ cursor: "pointer", width: "fit-content", color: "var(--gryt-accent-11)" }} onClick={resetZoom}>
            {tr("ui.resetTo100")}
          </span>
        )}
      </div>

      <div className="flex flex-col gap-2" id="chat-font-size" data-setting="chat-font-size">
        <div className="flex justify-between items-center">
          <span className="font-medium text-sm">{tr("ui.chatFontSize")}</span>
          <span className="text-xs text-gryt-muted">{chatFontSize}px</span>
        </div>
        <Slider
          min={10}
          max={24}
          step={1}
          value={chatFontSize}
          onValueChange={(next) => setChatFontSize(Number(next))}
        />
        <span className="text-xs text-gryt-muted" style={{ fontSize: chatFontSize, lineHeight: 1.5 }}>
          {tr("ui.previewTextAt")} {chatFontSize}px
        </span>
      </div>

      <div className="flex flex-col gap-2" id="standalone-emoji-size" data-setting="standalone-emoji-size">
        <div className="flex justify-between items-center">
          <span className="font-medium text-sm">{tr("ui.standaloneEmojiSize")}</span>
          <span className="text-xs text-gryt-muted">{emojiSize}px</span>
        </div>
        <Slider
          min={12}
          max={96}
          step={4}
          value={emojiSize}
          onValueChange={(next) => setEmojiSize(Number(next))}
        />
        <div className="flex items-center gap-2 pt-1">
          <span className="text-xs text-gryt-muted">{tr("ui.preview")}</span>
          <span style={{ fontSize: emojiSize, lineHeight: 1.25 }}>😀</span>
        </div>
      </div>
    </SettingsContainer>
  );
}
