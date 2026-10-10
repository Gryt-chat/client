export const LANGUAGE_STORAGE_KEY = "gryt.ui.language";
export const LANGUAGE_CHOICES = ["system", "en", "zh-CN"] as const;
export type LanguagePreference = typeof LANGUAGE_CHOICES[number];
export type AppLanguage = "en" | "zh-CN";

export function isLanguagePreference(value: unknown): value is LanguagePreference {
  return LANGUAGE_CHOICES.some((choice) => choice === value);
}

export function detectLanguage(languages: readonly string[]): AppLanguage {
  for (const language of languages) {
    const code = language.replace(/_/g, "-").toLowerCase();
    if (code === "zh" || /^zh-(cn|sg|hans)(-|$)/.test(code)) return "zh-CN";
    if (/^en(-|$)/.test(code)) return "en";
  }
  return "en";
}

export function readLanguagePreference(storage?: Pick<Storage, "getItem">): LanguagePreference {
  try {
    const value = storage?.getItem(LANGUAGE_STORAGE_KEY);
    return isLanguagePreference(value) ? value : "system";
  } catch {
    return "system";
  }
}

export function resolveLanguage(preference: LanguagePreference, languages: readonly string[]): AppLanguage {
  return preference === "system" ? detectLanguage(languages) : preference;
}
