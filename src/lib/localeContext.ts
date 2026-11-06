import { createContext, useContext } from "react";

import type { Locale, LocaleMessage, LocalePreference, TranslationParams } from "./i18n.ts";

export interface LocaleContextValue {
  locale: Locale;
  preference: LocalePreference;
  setPreference: (preference: LocalePreference) => void;
  t: (message: LocaleMessage, params?: TranslationParams) => string;
}

export const LocaleContext = createContext<LocaleContextValue | null>(null);

/** Reads the active locale and the translation helper inside the app tree. */
export function useLocale(): LocaleContextValue {
  const value = useContext(LocaleContext);
  if (!value) throw new Error("useLocale must be used inside LocaleProvider");
  return value;
}
