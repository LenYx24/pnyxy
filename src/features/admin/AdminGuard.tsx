import { Navigate } from "react-router";
import { useAuthStore } from "@/stores/auth-store";
import { Loader2 } from "lucide-react";

export function AdminGuard({ children }: { children: React.ReactNode }) {
  const { user, profile, loading } = useAuthStore();

  // Wait until the session AND the profile are resolved. A signed-in user
  // whose profile is still loading (a hard reload lands here before
  // fetchProfile resolves) must not be bounced as "not admin".
  if (loading || (user && !profile)) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-accent" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/auth" replace />;
  }

  if (profile?.role !== "admin") {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}
