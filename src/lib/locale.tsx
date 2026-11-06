import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { I18nextProvider } from "react-i18next";

import {
  getSystemLocale,
  i18n,
  type LocaleMessage,
  type LocalePreference,
  readLocalePreference,
  setLocalePreference,
  translateLocaleMessage,
  type TranslationParams,
} from "./i18n.ts";
import { LocaleContext } from "./localeContext";

export type { Locale, LocalePreference } from "./i18n.ts";
// eslint-disable-next-line react-refresh/only-export-components
export { translateLocaleMessage } from "./i18n.ts";

/** Provides the selected interface locale and the bundled translation resources. */
export function LocaleProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<LocalePreference>(readLocalePreference);
  const locale = preference === "system" ? getSystemLocale() : preference;

  const setPreference = useCallback((next: LocalePreference) => {
    setLocalePreference(next);
    setPreferenceState(next);
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale;
    void i18n.changeLanguage(locale);
  }, [locale]);

  const t = useCallback((message: LocaleMessage, params?: TranslationParams) => translateLocaleMessage(message, locale, params), [locale]);
  const value = useMemo(() => ({ locale, preference, setPreference, t }), [locale, preference, setPreference, t]);
  return <I18nextProvider i18n={i18n}><LocaleContext.Provider value={value}>{children}</LocaleContext.Provider></I18nextProvider>;
}
