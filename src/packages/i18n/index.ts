import i18next from "i18next";
import { initReactI18next, useTranslation } from "react-i18next";

import en from "./locales/en.json";
import zhCN from "./locales/zh-CN.json";
import { isLanguagePreference, LANGUAGE_STORAGE_KEY, type LanguagePreference, readLanguagePreference, resolveLanguage } from "./preferences";

function storage(): Storage | undefined {
  try { return globalThis.localStorage; } catch { return undefined; }
}

function systemLanguages(): readonly string[] {
  return typeof navigator === "undefined" ? [] : navigator.languages ?? [navigator.language];
}

let preference = readLanguagePreference(storage());
export const i18n = i18next.createInstance();
void i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, "zh-CN": { translation: zhCN } },
  lng: resolveLanguage(preference, systemLanguages()),
  fallbackLng: "en",
  supportedLngs: ["en", "zh-CN"],
  load: "currentOnly",
  initAsync: false,
  interpolation: { escapeValue: false },
  react: { useSuspense: false },
});

function updateDocumentLanguage() {
  if (typeof document !== "undefined") document.documentElement.lang = i18n.resolvedLanguage ?? "en";
}
i18n.on("languageChanged", updateDocumentLanguage);
updateDocumentLanguage();

export function getLanguagePreference(): LanguagePreference { return preference; }

export async function restoreLanguagePreference(): Promise<void> {
  preference = readLanguagePreference(storage());
  await i18n.changeLanguage(resolveLanguage(preference, systemLanguages()));
}

export async function setLanguagePreference(next: LanguagePreference): Promise<void> {
  if (!isLanguagePreference(next)) return;
  preference = next;
  try { storage()?.setItem(LANGUAGE_STORAGE_KEY, next); } catch { /* The session still switches when storage is blocked. */ }
  await i18n.changeLanguage(resolveLanguage(next, systemLanguages()));
}

if (typeof window !== "undefined") {
  window.addEventListener("languagechange", () => {
    if (preference === "system") void i18n.changeLanguage(resolveLanguage(preference, systemLanguages()));
  });
  window.addEventListener("storage", (event) => {
    if (event.key !== LANGUAGE_STORAGE_KEY && event.key !== null) return;
    void restoreLanguagePreference();
  });
}

export { useTranslation };
