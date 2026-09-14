import i18n from "@/lib/i18n";
import { logError } from "@/lib/logger";
import { useOrgStore } from "@/stores/org-store";
import { useUploadStore } from "@/stores/upload-store";

// Localised display name -> becomes the book title (upload-store derives the
// title from the file name). The PDFs live in public/onboarding/ and are built
// by scripts/build-onboarding-pdf.mjs.
const GUIDE = {
  hu: { file: "pnyxy-guide-hu.pdf", title: "Pnyxy útmutató" },
  en: { file: "pnyxy-guide-en.pdf", title: "Pnyxy Guide" },
} as const;

function pickLang(): keyof typeof GUIDE {
  const lang = (i18n.resolvedLanguage ?? i18n.language ?? "en").toLowerCase();
  return lang.startsWith("hu") ? "hu" : "en";
}

/**
 * Seed the "first steps" guide into the user's library. Called once per user
 * from the onboarding flow (WelcomePage) right after `markOnboarded()`.
 *
 * Safe to call more than once: the upload store dedupes by content hash per
 * user+org, so a re-run resolves to the existing book instead of duplicating
 * it. Fire-and-forget: never blocks navigation, and a failure is logged, not
 * surfaced (a missing guide must not break sign-up).
 */
export async function seedOnboardingBook(): Promise<void> {
  try {
    // The upload needs a resolved org; on a fresh sign-in it may not be
    // hydrated yet, so make sure it is before enqueuing.
    if (!useOrgStore.getState().currentOrgId) {
      await useOrgStore.getState().fetchMine();
    }
    if (!useOrgStore.getState().currentOrgId) return;

    const { file, title } = GUIDE[pickLang()];
    const url = `${import.meta.env.BASE_URL}onboarding/${file}`;
    const res = await fetch(url);
    if (!res.ok) {
      logError("onboarding:seedOnboardingBook", `fetch ${url} -> ${res.status}`);
      return;
    }
    const blob = await res.blob();
    const pdf = new File([blob], `${title}.pdf`, { type: "application/pdf" });

    // Fire-and-forget: the upload store surfaces its own progress UI and
    // refreshes the library on success.
    void useUploadStore.getState().uploadPdf(pdf);
  } catch (err) {
    logError("onboarding:seedOnboardingBook", err);
  }
}
