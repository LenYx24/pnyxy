import { useState, type FormEvent } from "react";
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { ArrowLeft } from "lucide-react";
import { MeshBackground, Button } from "@/components/ui";
import { useAuthStore } from "@/stores/auth-store";

export function ForgotPasswordPage() {
  const { t } = useTranslation();
  const { requestPasswordReset } = useAuthStore();
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setLocalError(null);
    setSubmitting(true);

    try {
      await requestPasswordReset(email);
      setSuccess(true);
    } catch (err) {
      if (err instanceof Error) {
        setLocalError(err.message);
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center px-4">
      <MeshBackground />

      <div className="relative z-10 w-full max-w-md rounded-xl border border-glass-border bg-glass-bg p-8 backdrop-blur-xl">
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-bold">
            <span className="bg-gradient-to-r from-accent to-accent-blue bg-clip-text text-transparent">
              Pnyxy
            </span>
          </h1>
          <p className="mt-1 text-sm text-text-muted">
            {t("auth.forgot.subtitle")}
          </p>
        </div>

        {success ? (
          <div className="space-y-4">
            <p className="rounded-lg bg-success/10 px-4 py-3 text-sm text-success">
              {t("auth.forgot.successBody")}
            </p>
            <Link to="/auth">
              <Button variant="secondary" className="w-full">
                <ArrowLeft size={16} />
                {t("auth.forgot.backToSignIn")}
              </Button>
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <p className="text-sm text-text-secondary">
              {t("auth.forgot.intro")}
            </p>

            <div>
              <label
                htmlFor="email"
                className="mb-1 block text-sm font-medium text-text-secondary"
              >
                {t("auth.email")}
              </label>
              <input
                id="email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-lg border border-glass-border bg-bg-primary/40 px-3 py-2.5 text-sm text-text-primary placeholder:text-text-muted backdrop-blur-md outline-none focus:border-accent/50 focus:ring-1 focus:ring-accent/25"
                placeholder="you@example.com"
                autoComplete="email"
                autoFocus
              />
            </div>

            {localError && (
              <p className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">
                {localError}
              </p>
            )}

            <Button type="submit" disabled={submitting} className="w-full">
              {submitting
                ? t("auth.forgot.sending")
                : t("auth.forgot.sendLink")}
            </Button>

            <Link to="/auth" className="block">
              <Button variant="ghost" className="w-full" type="button">
                <ArrowLeft size={16} />
                {t("auth.forgot.backToSignIn")}
              </Button>
            </Link>
          </form>
        )}
      </div>
    </div>
  );
}
