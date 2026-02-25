import { Button, Flex, Separator, Text } from "@radix-ui/themes";
import { nameToEmoji } from "gemoji";
import { useCallback, useMemo } from "react";

import { useSettings } from "@/settings";

import { SMILEY_ENTRIES } from "../../../socket/src/utils/remarkEmoji";
import { ToggleSetting } from "./settingsComponents";

const CATEGORY_ORDER: { label: string; shortcodes: string[] }[] = [
  {
    label: "Happy",
    shortcodes: [
      "slightly_smiling_face", "smile", "grin", "blush", "smirk",
      "laughing", "joy", "sweat_smile", "wink",
    ],
  },
  {
    label: "Love",
    shortcodes: ["kissing_heart", "heart", "broken_heart"],
  },
  {
    label: "Tongue",
    shortcodes: [
      "stuck_out_tongue", "stuck_out_tongue_winking_eye", "stuck_out_tongue_closed_eyes",
    ],
  },
  {
    label: "Cool / Halo",
    shortcodes: ["sunglasses", "innocent"],
  },
  {
    label: "Sad",
    shortcodes: [
      "disappointed", "pensive", "cry", "sob", "anguished", "weary",
    ],
  },
  {
    label: "Angry / Evil",
    shortcodes: ["angry", "rage", "smiling_imp", "imp"],
  },
  {
    label: "Surprised",
    shortcodes: ["open_mouth", "astonished", "scream"],
  },
  {
    label: "Confused / Neutral",
    shortcodes: [
      "confused", "neutral_face", "expressionless", "persevere",
      "flushed", "dizzy_face", "star_struck",
    ],
  },
  {
    label: "Sealed / Tired",
    shortcodes: ["zipper_mouth_face", "no_mouth", "sleeping", "tired_face", "skull"],
  },
  {
    label: "Other",
    shortcodes: ["smiley_cat", "raised_hands", "wave"],
  },
];

const entryByShortcode = new Map(SMILEY_ENTRIES.map((e) => [e.shortcode, e]));

function primarySmiley(shortcode: string): string {
  const entry = entryByShortcode.get(shortcode);
  if (!entry) return "";
  return entry.smileys.find((s) => s.length <= 3) ?? entry.smileys[0];
}

export function SmileySettings() {
  const {
    smileyConversion,
    setSmileyConversion,
    disabledSmileys,
    setDisabledSmileys,
  } = useSettings();

  const allShortcodes = useMemo(
    () => CATEGORY_ORDER.flatMap((c) => c.shortcodes),
    [],
  );

  const toggleOne = useCallback(
    (shortcode: string) => {
      const next = new Set(disabledSmileys);
      if (next.has(shortcode)) next.delete(shortcode);
      else next.add(shortcode);
      setDisabledSmileys(next);
    },
    [disabledSmileys, setDisabledSmileys],
  );

  const enableAll = useCallback(
    () => setDisabledSmileys(new Set()),
    [setDisabledSmileys],
  );

  const disableAll = useCallback(
    () => setDisabledSmileys(new Set(allShortcodes)),
    [setDisabledSmileys, allShortcodes],
  );

  return (
    <Flex direction="column" gap="3">
      <ToggleSetting
        title="Smiley Conversion"
        description="Automatically convert text smileys like :) and :D into emoji"
        checked={smileyConversion}
        onCheckedChange={setSmileyConversion}
      />

      {smileyConversion && (
        <Flex direction="column" gap="3" pl="1">
          <Flex gap="2">
            <Button size="1" variant="soft" onClick={enableAll}>
              Enable All
            </Button>
            <Button size="1" variant="soft" color="gray" onClick={disableAll}>
              Disable All
            </Button>
          </Flex>

          {CATEGORY_ORDER.map((cat) => (
            <Flex key={cat.label} direction="column" gap="1">
              <Text size="1" color="gray" weight="medium">
                {cat.label}
              </Text>
              <Flex gap="2" wrap="wrap">
                {cat.shortcodes.map((sc) => {
                  const emoji = nameToEmoji[sc];
                  if (!emoji) return null;
                  const active = !disabledSmileys.has(sc);
                  return (
                    <button
                      key={sc}
                      type="button"
                      onClick={() => toggleOne(sc)}
                      title={`:${sc}: ${primarySmiley(sc)}`}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 4,
                        padding: "3px 8px",
                        borderRadius: 6,
                        border: "1px solid var(--gray-a6)",
                        background: active ? "var(--accent-a3)" : "var(--gray-a2)",
                        opacity: active ? 1 : 0.4,
                        cursor: "pointer",
                        fontSize: 13,
                        lineHeight: 1.4,
                        transition: "opacity 0.15s, background 0.15s",
                      }}
                    >
                      <span style={{ fontSize: 16 }}>{emoji}</span>
                      <span style={{ color: "var(--gray-11)", fontFamily: "var(--code-font-family, monospace)" }}>
                        {primarySmiley(sc)}
                      </span>
                    </button>
                  );
                })}
              </Flex>
            </Flex>
          ))}

          <Separator size="4" />
          <Text size="1" color="gray">
            Click a chip to toggle that conversion on or off. Disabled
            smileys stay as typed text.
          </Text>
        </Flex>
      )}
    </Flex>
  );
}
