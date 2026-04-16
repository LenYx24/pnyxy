import { Link } from "react-router";
import { CheckCircle2 } from "lucide-react";
import { MeshBackground, Button } from "@/components/ui";
import { useAuthStore } from "@/stores/auth-store";

export function WelcomePage() {
  const user = useAuthStore((s) => s.user);

  return (
    <div className="relative flex min-h-screen items-center justify-center px-4">
      <MeshBackground />

      <div className="relative z-10 w-full max-w-md rounded-xl border border-glass-border bg-glass-bg p-8 text-center backdrop-blur-xl">
        <div className="mb-6 flex justify-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/15">
            <CheckCircle2 size={36} className="text-emerald-400" />
          </div>
        </div>

        <h1 className="text-3xl font-bold">
          <span className="bg-gradient-to-r from-accent-purple to-accent-blue bg-clip-text text-transparent">
            Welcome to Pnyxy!
          </span>
        </h1>
        <p className="mt-3 text-sm text-text-secondary">
          Your email is confirmed. You're all set to start building your library.
        </p>

        <div className="mt-8">
          <Link to={user ? "/library" : "/auth"}>
            <Button className="w-full">
              {user ? "Continue to your library" : "Sign in"}
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
