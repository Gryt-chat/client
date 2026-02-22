import { useEffect, useMemo, useState } from "react";
import { singletonHook } from "react-singleton-hook";

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

  hasBackground: boolean;
  setHasBackground: (value: boolean) => void;

  panelBackground: "solid" | "translucent";
  setPanelBackground: (value: "solid" | "translucent") => void;

  radius: "none" | "small" | "medium" | "large" | "full";
  setRadius: (value: "none" | "small" | "medium" | "large" | "full") => void;

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
  const [hasBackground, setHasBackgroundState] = useState<boolean>(
    localStorage.getItem("theme.hasBackground") !== "false"
  );
  const [panelBackground, setPanelBackgroundState] = useState<"solid" | "translucent">(
    ((localStorage.getItem("theme.panelBackground") as "solid" | "translucent") || "translucent")
  );
  const [radius, setRadiusState] = useState<"none" | "small" | "medium" | "large" | "full">(
    ((localStorage.getItem("theme.radius") as "none" | "small" | "medium" | "large" | "full") || "full")
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

  function setHasBackground(value: boolean) {
    setHasBackgroundState(value);
    localStorage.setItem("theme.hasBackground", value.toString());
  }

  function setPanelBackground(value: "solid" | "translucent") {
    setPanelBackgroundState(value);
    localStorage.setItem("theme.panelBackground", value);
  }

  function setRadius(value: "none" | "small" | "medium" | "large" | "full") {
    setRadiusState(value);
    localStorage.setItem("theme.radius", value);
  }

  function setAppearancePreference(value: AppearancePreference) {
    setAppearancePreferenceState(value);
    localStorage.setItem("theme.appearancePreference", value);
  }

  return {
    appearancePreference,
    setAppearancePreference,
    accentColor,
    setAccentColor,
    grayColor,
    setGrayColor,
    hasBackground,
    setHasBackground,
    panelBackground,
    setPanelBackground,
    radius,
    setRadius,
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
  hasBackground: localStorage.getItem("theme.hasBackground") !== "false",
  setHasBackground: () => {},
  panelBackground: ((localStorage.getItem("theme.panelBackground") as "solid" | "translucent") || "translucent"),
  setPanelBackground: () => {},
  radius: ((localStorage.getItem("theme.radius") as "none" | "small" | "medium" | "large" | "full") || "full"),
  setRadius: () => {},
  // Resolve initial appearance from system preference to avoid initial flash
  resolvedAppearance: (typeof window !== "undefined" && (window.matchMedia?.("(prefers-color-scheme: dark)").matches)) ? "dark" : "light",
};

export const useTheme = singletonHook(init, useThemeHook);

export const accentColors: AccentColor[] = [
  "yellow","amber","orange","tomato","red","ruby","pink","plum","purple","violet","iris","indigo","blue","cyan","teal","jade","green","grass","lime","mint","sky"
];

export const grayColors: GrayColor[] = ["gray","mauve","slate","sage","olive","sand"];


