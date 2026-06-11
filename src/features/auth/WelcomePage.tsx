import { useState } from "react";
import { Link, Navigate, useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { CheckCircle2, Loader2 } from "lucide-react";
import { MeshBackground, Button } from "@/components/ui";
import { useAuthStore } from "@/stores/auth-store";

export function WelcomePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const profile = useAuthStore((s) => s.profile);
  const markOnboarded = useAuthStore((s) => s.markOnboarded);
  const [submitting, setSubmitting] = useState(false);

  // Anonymous visitor — surface a sign-in CTA instead of a welcome.
  if (!user) {
    return (
      <div className="relative flex min-h-screen items-center justify-center px-4">
        <MeshBackground />
        <div className="relative z-10 w-full max-w-md rounded-xl border border-glass-border bg-glass-bg p-8 text-center backdrop-blur-xl">
          <h1 className="text-3xl font-bold">
            <span className="bg-gradient-to-r from-accent to-accent-blue bg-clip-text text-transparent">
              {t("auth.welcome.title")}
            </span>
          </h1>
          <p className="mt-3 text-sm text-text-secondary">
            {t("auth.welcome.body")}
          </p>
          <div className="mt-8">
            <Link to="/auth">
              <Button className="w-full">{t("auth.signIn")}</Button>
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // Profile not hydrated yet — brief loading state to avoid a flash
  // of the welcome card for returning users who'll be redirected.
  if (!profile) {
    return (
      <div className="relative flex min-h-screen items-center justify-center px-4">
        <MeshBackground />
        <Loader2 className="relative z-10 animate-spin text-text-muted" size={28} />
      </div>
    );
  }

  // Returning user — already onboarded, skip straight to the app.
  if (profile.onboarded) {
    return <Navigate to="/library" replace />;
  }

  async function handleContinue() {
    setSubmitting(true);
    try {
      await markOnboarded();
      navigate("/library");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center px-4">
      <MeshBackground />

      <div className="relative z-10 w-full max-w-md rounded-xl border border-glass-border bg-glass-bg p-8 text-center backdrop-blur-xl">
        <div className="mb-6 flex justify-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-success/15">
            <CheckCircle2 size={36} className="text-success" />
          </div>
        </div>

        <h1 className="text-3xl font-bold">
          <span className="bg-gradient-to-r from-accent to-accent-blue bg-clip-text text-transparent">
            {t("auth.welcome.title")}
          </span>
        </h1>
        <p className="mt-3 text-sm text-text-secondary">
          {t("auth.welcome.body")}
        </p>

        <div className="mt-8">
          <Button
            className="w-full"
            disabled={submitting}
            onClick={handleContinue}
          >
            {submitting ? t("common.loading") : t("auth.welcome.continueCta")}
          </Button>
        </div>
      </div>
    </div>
  );
}
