import { useEffect, useMemo, useState } from "react";

import { singletonHook } from "./singletonHook";

type AppearancePreference = "system" | "light" | "dark";
type AppearanceResolved = "light" | "dark";

type AccentColor =
  | "yellow"
  | "amber"
  | "orange"
  | "tomato"
  | "red"
  | "ruby"
  | "pink"
  | "plum"
  | "purple"
  | "violet"
  | "iris"
  | "indigo"
  | "blue"
  | "cyan"
  | "teal"
  | "jade"
  | "green"
  | "grass"
  | "lime"
  | "mint"
  | "sky";

type GrayColor = "gray" | "mauve" | "slate" | "sage" | "olive" | "sand";

export interface ThemeSettings {
  appearancePreference: AppearancePreference;
  setAppearancePreference: (value: AppearancePreference) => void;

  accentColor: AccentColor;
  setAccentColor: (value: AccentColor) => void;

  grayColor: GrayColor;
  setGrayColor: (value: GrayColor) => void;

  radius: "none" | "small" | "medium" | "large" | "full";
  setRadius: (value: "none" | "small" | "medium" | "large" | "full") => void;

  emojiSize: number;
  setEmojiSize: (value: number) => void;

  chatFontSize: number;
  setChatFontSize: (value: number) => void;

  uiScale: number;
  setUiScale: (value: number) => void;
  zoomIn: () => void;
  zoomOut: () => void;
  resetZoom: () => void;

  // Derived, read-only
  resolvedAppearance: AppearanceResolved;
}

function useThemeHook(): ThemeSettings {
  const [appearancePreference, setAppearancePreferenceState] = useState<AppearancePreference>(
    (localStorage.getItem("theme.appearancePreference") as AppearancePreference) || "system"
  );
  const [accentColor, setAccentColorState] = useState<AccentColor>(
    ((localStorage.getItem("theme.accentColor") as AccentColor) || "violet")
  );
  const [grayColor, setGrayColorState] = useState<GrayColor>(
    ((localStorage.getItem("theme.grayColor") as GrayColor) || "slate")
  );
  const [radius, setRadiusState] = useState<"none" | "small" | "medium" | "large" | "full">(
    ((localStorage.getItem("theme.radius") as "none" | "small" | "medium" | "large" | "full") || "full")
  );
  const [emojiSize, setEmojiSizeState] = useState<number>(
    Number(localStorage.getItem("theme.emojiSize")) || 64
  );
  const [chatFontSize, setChatFontSizeState] = useState<number>(
    Number(localStorage.getItem("theme.chatFontSize")) || 16
  );
  const [uiScale, setUiScaleState] = useState<number>(
    Number(localStorage.getItem("theme.uiScale")) || 1
  );

  // System color scheme listener when preference is 'system'
  const systemPrefersDark = useMemo(() =>
    typeof window !== "undefined" && window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : undefined,
  []);

  const [systemIsDark, setSystemIsDark] = useState<boolean>(() => !!systemPrefersDark?.matches);

  useEffect(() => {
    if (!systemPrefersDark) return;
    function handleChange(ev: MediaQueryListEvent) {
      setSystemIsDark(ev.matches);
    }
    systemPrefersDark.addEventListener("change", handleChange);
    return () => systemPrefersDark.removeEventListener("change", handleChange);
  }, [systemPrefersDark]);

  const resolvedAppearance: AppearanceResolved =
    appearancePreference === "system" ? (systemIsDark ? "dark" : "light") : appearancePreference;

  function setAccentColor(value: AccentColor) {
    setAccentColorState(value);
    localStorage.setItem("theme.accentColor", value);
  }

  function setGrayColor(value: GrayColor) {
    setGrayColorState(value);
    localStorage.setItem("theme.grayColor", value);
  }

  function setRadius(value: "none" | "small" | "medium" | "large" | "full") {
    setRadiusState(value);
    localStorage.setItem("theme.radius", value);
  }

  function setAppearancePreference(value: AppearancePreference) {
    setAppearancePreferenceState(value);
    localStorage.setItem("theme.appearancePreference", value);
  }

  function setEmojiSize(value: number) {
    const clamped = Math.round(Math.max(12, Math.min(96, value)) / 4) * 4;
    setEmojiSizeState(clamped);
    localStorage.setItem("theme.emojiSize", clamped.toString());
  }

  function setChatFontSize(value: number) {
    const clamped = Math.max(10, Math.min(24, Math.round(value)));
    setChatFontSizeState(clamped);
    localStorage.setItem("theme.chatFontSize", clamped.toString());
  }

  const SCALE_STEP = 0.1;
  const SCALE_MIN = 0.5;
  const SCALE_MAX = 2.0;

  function clampScale(v: number): number {
    return Math.round(Math.max(SCALE_MIN, Math.min(SCALE_MAX, v)) * 100) / 100;
  }

  function setUiScale(value: number) {
    const clamped = clampScale(value);
    setUiScaleState(clamped);
    localStorage.setItem("theme.uiScale", clamped.toString());
  }

  function zoomIn() {
    setUiScale(uiScale + SCALE_STEP);
  }

  function zoomOut() {
    setUiScale(uiScale - SCALE_STEP);
  }

  function resetZoom() {
    setUiScale(1);
  }

  return {
    appearancePreference,
    setAppearancePreference,
    accentColor,
    setAccentColor,
    grayColor,
    setGrayColor,
    radius,
    setRadius,
    emojiSize,
    setEmojiSize,
    chatFontSize,
    setChatFontSize,
    uiScale,
    setUiScale,
    zoomIn,
    zoomOut,
    resetZoom,
    resolvedAppearance,
  };
}

const init: ThemeSettings = {
  appearancePreference: (localStorage.getItem("theme.appearancePreference") as AppearancePreference) || "system",
  setAppearancePreference: () => {},
  accentColor: ((localStorage.getItem("theme.accentColor") as AccentColor) || "violet"),
  setAccentColor: () => {},
  grayColor: ((localStorage.getItem("theme.grayColor") as GrayColor) || "slate"),
  setGrayColor: () => {},
  radius: ((localStorage.getItem("theme.radius") as "none" | "small" | "medium" | "large" | "full") || "full"),
  setRadius: () => {},
  emojiSize: Number(localStorage.getItem("theme.emojiSize")) || 64,
  setEmojiSize: () => {},
  chatFontSize: Number(localStorage.getItem("theme.chatFontSize")) || 16,
  setChatFontSize: () => {},
  uiScale: Number(localStorage.getItem("theme.uiScale")) || 1,
  setUiScale: () => {},
  zoomIn: () => {},
  zoomOut: () => {},
  resetZoom: () => {},
  // Resolve initial appearance from system preference to avoid initial flash
  resolvedAppearance: (typeof window !== "undefined" && (window.matchMedia?.("(prefers-color-scheme: dark)").matches)) ? "dark" : "light",
};

export const useTheme = singletonHook(init, useThemeHook);

export const accentColors: AccentColor[] = [
  "yellow","amber","orange","tomato","red","ruby","pink","plum","purple","violet","iris","indigo","blue","cyan","teal","jade","green","grass","lime","mint","sky"
];

export const grayColors: GrayColor[] = ["gray","mauve","slate","sage","olive","sand"];


