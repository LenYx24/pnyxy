import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { Eye, EyeOff } from "lucide-react";
import { MeshBackground, Button } from "@/components/ui";
import { useAuthStore } from "@/stores/auth-store";

export function ResetPasswordPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { session, updatePassword } = useAuthStore();
  const [checkedSession, setCheckedSession] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  // Give Supabase's auto-session-from-URL a tick to land before we render
  // the "invalid/expired" state.
  useEffect(() => {
    const timer = setTimeout(() => setCheckedSession(true), 500);
    return () => clearTimeout(timer);
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setLocalError(null);

    if (password.length < 6) {
      setLocalError(t("auth.reset.tooShort"));
      return;
    }
    if (password !== confirmPassword) {
      setLocalError(t("auth.reset.mismatch"));
      return;
    }

    setSubmitting(true);
    try {
      await updatePassword(password);
      navigate("/library");
    } catch (err) {
      if (err instanceof Error) {
        setLocalError(err.message);
      }
    } finally {
      setSubmitting(false);
    }
  }

  const linkInvalid = checkedSession && !session;

  return (
    <div className="relative flex min-h-screen items-center justify-center px-4">
      <MeshBackground />

      <div className="relative z-10 w-full max-w-md rounded-xl border border-glass-border bg-glass-bg p-8 backdrop-blur-xl">
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-bold">
            <span className="bg-gradient-to-r from-accent-purple to-accent-blue bg-clip-text text-transparent">
              Pnyxy
            </span>
          </h1>
          <p className="mt-1 text-sm text-text-muted">
            {t("auth.reset.subtitle")}
          </p>
        </div>

        {linkInvalid ? (
          <div className="space-y-4">
            <p className="rounded-lg bg-red-500/10 px-4 py-3 text-sm text-red-400">
              {t("auth.reset.linkInvalid")}
            </p>
            <Link to="/auth/forgot-password">
              <Button variant="secondary" className="w-full">
                {t("auth.reset.requestNew")}
              </Button>
            </Link>
          </div>
        ) : !checkedSession ? (
          <p className="text-center text-sm text-text-muted">
            {t("common.loading")}
          </p>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label
                htmlFor="new-password"
                className="mb-1 block text-sm font-medium text-text-secondary"
              >
                {t("auth.reset.newPassword")}
              </label>
              <div className="relative">
                <input
                  id="new-password"
                  type={showPassword ? "text" : "password"}
                  required
                  minLength={6}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full rounded-lg border border-glass-border bg-bg-primary/40 px-3 pr-10 py-2.5 text-sm text-text-primary placeholder:text-text-muted backdrop-blur-md outline-none focus:border-accent-purple/50 focus:ring-1 focus:ring-accent-purple/25"
                  placeholder="••••••••"
                  autoComplete="new-password"
                  autoFocus
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 cursor-pointer text-text-muted hover:text-text-secondary"
                  aria-label={
                    showPassword
                      ? t("auth.hidePassword")
                      : t("auth.showPassword")
                  }
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>

            <div>
              <label
                htmlFor="confirm-password"
                className="mb-1 block text-sm font-medium text-text-secondary"
              >
                {t("auth.reset.confirmNewPassword")}
              </label>
              <input
                id="confirm-password"
                type={showPassword ? "text" : "password"}
                required
                minLength={6}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="w-full rounded-lg border border-glass-border bg-bg-primary/40 px-3 py-2.5 text-sm text-text-primary placeholder:text-text-muted backdrop-blur-md outline-none focus:border-accent-purple/50 focus:ring-1 focus:ring-accent-purple/25"
                placeholder="••••••••"
                autoComplete="new-password"
              />
            </div>

            {localError && (
              <p className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-400">
                {localError}
              </p>
            )}

            <Button type="submit" disabled={submitting} className="w-full">
              {submitting
                ? t("auth.reset.updating")
                : t("auth.reset.updatePassword")}
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
