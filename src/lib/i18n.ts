import { createInstance } from "i18next";

import en from "../locales/en.json" with { type: "json" };
import ptBR from "../locales/pt-BR.json" with { type: "json" };

export type Locale = "en" | "pt-BR";
export type LocalePreference = "system" | Locale;
export interface TranslationMessage {
  key: string;
  params?: TranslationParams;
}
export type LocaleMessage = string | TranslationMessage;
export type TranslationParams = Record<string, string | number | TranslationMessage>;

/** Keep asynchronous diagnostic results translatable when the selected locale changes. */
export function localeMessage(key: string, params?: TranslationParams): TranslationMessage {
  return { key, params };
}

const STORAGE_KEY = "gryt:locale";
let inMemoryPreference: LocalePreference | null = null;

/** Read the persisted preference without requiring browser storage to be available. */
export function readLocalePreference(): LocalePreference {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "en" || saved === "pt-BR") return saved;
  } catch {
    // Storage may be unavailable; the preference still works for this session.
  }
  return "system";
}

/** Resolve the system language separately from the user's selected language. */
export function getSystemLocale(): Locale {
  return typeof navigator !== "undefined" && navigator.language.toLowerCase().startsWith("pt") ? "pt-BR" : "en";
}

/** Resolve the same in-memory preference for React and socket/event listeners. */
export function getActiveLocale(): Locale {
  const preference = inMemoryPreference ?? readLocalePreference();
  return preference === "system" ? getSystemLocale() : preference;
}

export const i18n = createInstance();
void i18n.init({
  resources: { en: { translation: en }, "pt-BR": { translation: ptBR } },
  lng: getActiveLocale(),
  fallbackLng: "en",
  supportedLngs: ["en", "pt-BR"],
  load: "currentOnly",
  initAsync: false,
  nsSeparator: false,
  returnEmptyString: false,
  interpolation: { escapeValue: false },
});

/** Apply a preference immediately, even if persisting it fails. */
export function setLocalePreference(preference: LocalePreference): void {
  inMemoryPreference = preference;
  void i18n.changeLanguage(getActiveLocale());
  try {
    if (preference === "system") localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, preference);
  } catch {
    // The selection remains in memory for this session.
  }
}

function sourceIndex(tree: Record<string, string | object>, prefix = "", index = new Map<string, string>()): Map<string, string> {
  for (const [name, value] of Object.entries(tree)) {
    const key = prefix ? `${prefix}.${name}` : name;
    if (typeof value === "string") {
      // Shared settings titles retain their existing English IDs for search anchors.
      if (!index.has(value)) index.set(value, key);
      const original = value.replace(/\{\{(\w+)\}\}/g, "{$1}");
      if (!index.has(original)) index.set(original, key);
    } else sourceIndex(value as Record<string, string | object>, key, index);
  }
  return index;
}

const sourceKeys = sourceIndex(en);

/** Translate a semantic key or an exact known server message; preserve unknown free text. */
export function translateLocaleMessage(message: LocaleMessage, localeOverride?: Locale, params?: TranslationParams): string {
  const locale = localeOverride ?? getActiveLocale();
  if (typeof message !== "string") return translateLocaleMessage(message.key, locale, message.params);
  const key = sourceKeys.get(message) ?? message;
  const values = Object.fromEntries(Object.entries(params ?? {}).map(([name, value]) => [
    name, typeof value === "object" ? translateLocaleMessage(value, locale) : value,
  ]));
  return i18n.t(key, { ...values, lng: locale, defaultValue: message });
}
