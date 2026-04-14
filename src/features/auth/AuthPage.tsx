import { useState, type FormEvent } from "react";
import { Navigate, useNavigate } from "react-router";
import { Eye, EyeOff } from "lucide-react";
import { MeshBackground, Button } from "@/components/ui";
import { useAuthStore } from "@/stores/auth-store";

type AuthTab = "sign-in" | "create-account";

export function AuthPage() {
  const navigate = useNavigate();
  const { user, signIn, signUp, error } = useAuthStore();
  const [tab, setTab] = useState<AuthTab>("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  if (user) {
    return <Navigate to="/app/library" replace />;
  }

  const displayError = localError ?? error;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setLocalError(null);
    setSubmitting(true);

    try {
      if (tab === "sign-in") {
        await signIn(email, password);
      } else {
        await signUp(email, password);
      }
      navigate("/app/library");
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
          {(["sign-in", "create-account"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => {
                setTab(t);
                setLocalError(null);
              }}
              className={`flex-1 rounded-md px-3 py-2 text-sm font-medium transition-colors cursor-pointer ${
                tab === t
                  ? "bg-accent-purple/15 text-accent-purple"
                  : "text-text-muted hover:text-text-secondary"
              }`}
            >
              {t === "sign-in" ? "Sign In" : "Create Account"}
            </button>
          ))}
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="email"
              className="mb-1 block text-sm font-medium text-text-secondary"
            >
              Email
            </label>
            <input
              id="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-lg border border-glass-border bg-bg-primary/40 px-3 py-2.5 text-sm text-text-primary placeholder:text-text-muted backdrop-blur-md outline-none focus:border-accent-purple/50 focus:ring-1 focus:ring-accent-purple/25"
              placeholder="you@example.com"
            />
          </div>

          <div>
            <label
              htmlFor="password"
              className="mb-1 block text-sm font-medium text-text-secondary"
            >
              Password
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
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-2 top-1/2 -translate-y-1/2 cursor-pointer text-text-muted hover:text-text-secondary"
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </div>

          {displayError && (
            <p className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-400">
              {displayError}
            </p>
          )}

          <Button
            type="submit"
            disabled={submitting}
            className="w-full"
          >
            {submitting
              ? "Loading..."
              : tab === "sign-in"
                ? "Sign In"
                : "Create Account"}
          </Button>
        </form>

        {/* Divider */}
        <div className="my-6 flex items-center gap-3">
          <div className="h-px flex-1 bg-glass-border" />
          <span className="text-xs text-text-muted">or</span>
          <div className="h-px flex-1 bg-glass-border" />
        </div>

        {/* Anonymous option */}
        <Button
          variant="ghost"
          className="w-full"
          onClick={() => navigate("/app/library")}
        >
          Continue without account
        </Button>
      </div>
    </div>
  );
}
