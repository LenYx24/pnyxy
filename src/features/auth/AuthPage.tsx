import { useState, type FormEvent } from "react";
import { Link, Navigate, useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { Eye, EyeOff } from "lucide-react";
import { MeshBackground, Button } from "@/components/ui";
import { useAuthStore } from "@/stores/auth-store";

type AuthTab = "sign-in" | "create-account";

function GoogleIcon({ size = 18 }: { size?: number }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 48 48"
      aria-hidden="true"
    >
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
  );
}

export function AuthPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user, signIn, signUp, signInWithGoogle, error } = useAuthStore();
  const [tab, setTab] = useState<AuthTab>("sign-in");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [googleSubmitting, setGoogleSubmitting] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [signUpSuccess, setSignUpSuccess] = useState(false);

  if (user) {
    return <Navigate to="/library" replace />;
  }

  const displayError = localError ?? error;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setLocalError(null);
    setSignUpSuccess(false);
    setSubmitting(true);

    try {
      if (tab === "sign-in") {
        await signIn(email, password);
        navigate("/auth/welcome");
      } else {
        await signUp(email, password, displayName.trim() || undefined);
        // If email confirmation is enabled, no session will be created immediately.
        const { session } = useAuthStore.getState();
        if (session?.user) {
          navigate("/auth/welcome");
        } else {
          setSignUpSuccess(true);
        }
      }
    } catch (err) {
      if (err instanceof Error) {
        setLocalError(err.message);
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function handleGoogleSignIn() {
    setLocalError(null);
    setGoogleSubmitting(true);
    try {
      await signInWithGoogle();
      // OAuth redirect handles navigation.
    } catch (err) {
      if (err instanceof Error) {
        setLocalError(err.message);
      }
      setGoogleSubmitting(false);
    }
  }

  function handleTabChange(next: AuthTab) {
    setTab(next);
    setLocalError(null);
    setSignUpSuccess(false);
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center px-4">
      <MeshBackground />

      <div className="relative z-10 w-full max-w-md rounded-xl border border-glass-border bg-glass-bg p-8 backdrop-blur-xl">
        {/* Logo */}
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-bold">
            <span className="bg-gradient-to-r from-accent-purple to-accent-blue bg-clip-text text-transparent">
              Pnyxy
            </span>
          </h1>
          <p className="mt-1 text-sm text-text-muted">
            Your intelligent reading companion
          </p>
        </div>

        {/* Tab toggle */}
        <div className="mb-6 flex rounded-lg border border-glass-border bg-bg-primary/40 p-1">
          {(["sign-in", "create-account"] as const).map((tabKey) => (
            <button
              key={tabKey}
              type="button"
              onClick={() => handleTabChange(tabKey)}
              className={`flex-1 rounded-md px-3 py-2 text-sm font-medium transition-colors cursor-pointer ${
                tab === tabKey
                  ? "bg-accent-purple/15 text-accent-purple"
                  : "text-text-muted hover:text-text-secondary"
              }`}
            >
              {tabKey === "sign-in"
                ? t("auth.signIn")
                : t("auth.createAccount")}
            </button>
          ))}
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          {tab === "create-account" && (
            <div>
              <label
                htmlFor="display-name"
                className="mb-1 block text-sm font-medium text-text-secondary"
              >
                {t("auth.displayName")}
              </label>
              <input
                id="display-name"
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className="w-full rounded-lg border border-glass-border bg-bg-primary/40 px-3 py-2.5 text-sm text-text-primary placeholder:text-text-muted backdrop-blur-md outline-none focus:border-accent-purple/50 focus:ring-1 focus:ring-accent-purple/25"
                placeholder={t("auth.displayNamePlaceholder")}
                autoComplete="name"
              />
            </div>
          )}

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
              className="w-full rounded-lg border border-glass-border bg-bg-primary/40 px-3 py-2.5 text-sm text-text-primary placeholder:text-text-muted backdrop-blur-md outline-none focus:border-accent-purple/50 focus:ring-1 focus:ring-accent-purple/25"
              placeholder="you@example.com"
              autoComplete="email"
            />
          </div>

          <div>
            <label
              htmlFor="password"
              className="mb-1 block text-sm font-medium text-text-secondary"
            >
              {t("auth.password")}
            </label>
            <div className="relative">
              <input
                id="password"
                type={showPassword ? "text" : "password"}
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-lg border border-glass-border bg-bg-primary/40 px-3 pr-10 py-2.5 text-sm text-text-primary placeholder:text-text-muted backdrop-blur-md outline-none focus:border-accent-purple/50 focus:ring-1 focus:ring-accent-purple/25"
                placeholder="••••••••"
                autoComplete={tab === "sign-in" ? "current-password" : "new-password"}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-2 top-1/2 -translate-y-1/2 cursor-pointer text-text-muted hover:text-text-secondary"
                aria-label={
                  showPassword ? t("auth.hidePassword") : t("auth.showPassword")
                }
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
            {tab === "sign-in" && (
              <div className="mt-1.5 text-right">
                <Link
                  to="/auth/forgot-password"
                  className="text-xs text-accent-purple hover:underline"
                >
                  {t("auth.forgotPassword")}
                </Link>
              </div>
            )}
          </div>

          {displayError && (
            <p className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-400">
              {displayError}
            </p>
          )}

          {signUpSuccess && (
            <p className="rounded-lg bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300">
              {t("auth.checkEmail")}
            </p>
          )}

          <Button
            type="submit"
            disabled={submitting}
            className="w-full"
          >
            {submitting
              ? t("common.loading")
              : tab === "sign-in"
                ? t("auth.signIn")
                : t("auth.createAccount")}
          </Button>
        </form>

        <div className="my-6 flex items-center gap-3">
          <div className="h-px flex-1 bg-glass-border" />
          <span className="text-xs text-text-muted">{t("auth.or")}</span>
          <div className="h-px flex-1 bg-glass-border" />
        </div>

        <Button
          variant="secondary"
          className="w-full"
          disabled={googleSubmitting}
          onClick={handleGoogleSignIn}
        >
          <GoogleIcon size={18} />
          {googleSubmitting
            ? t("auth.redirecting")
            : t("auth.continueWithGoogle")}
        </Button>

        <Button
          variant="ghost"
          className="mt-3 w-full"
          onClick={() => navigate("/library")}
        >
          {t("auth.continueAnonymous")}
        </Button>
      </div>
    </div>
  );
}
