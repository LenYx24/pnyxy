import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import en from "@/locales/en.json";
import hu from "@/locales/hu.json";

export const SUPPORTED_LANGUAGES = ["en", "hu"] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

export const DEFAULT_LANGUAGE: SupportedLanguage = "en";

const LOCAL_STORAGE_KEY = "pnyxy-reader:language";

/** True when the argument is a language we ship translations for. */
export function isSupportedLanguage(v: unknown): v is SupportedLanguage {
  return typeof v === "string" &&
    (SUPPORTED_LANGUAGES as readonly string[]).includes(v);
}

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      hu: { translation: hu },
    },
    fallbackLng: DEFAULT_LANGUAGE,
    supportedLngs: [...SUPPORTED_LANGUAGES],
    // `nonExplicitSupportedLngs: true` lets "hu-HU" match "hu", etc.
    nonExplicitSupportedLngs: true,
    interpolation: {
      // React already escapes interpolated text.
      escapeValue: false,
    },
    detection: {
      order: ["localStorage", "navigator"],
      lookupLocalStorage: LOCAL_STORAGE_KEY,
      caches: ["localStorage"],
    },
  });

/** Explicitly switch languages and persist. Separate from Settings
 *  store to keep the i18n instance authoritative. */
export async function setLanguage(lang: SupportedLanguage): Promise<void> {
  await i18n.changeLanguage(lang);
  try {
    localStorage.setItem(LOCAL_STORAGE_KEY, lang);
  } catch {
    // localStorage might be unavailable in some embedded contexts.
  }
}

export default i18n;
