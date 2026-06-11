import { Navigate } from "react-router";
import { useAuthStore } from "@/stores/auth-store";
import { Loader2 } from "lucide-react";

export function AdminGuard({ children }: { children: React.ReactNode }) {
  const { profile, loading } = useAuthStore();

  if (loading) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-accent" />
      </div>
    );
  }

  if (profile?.role !== "admin") {
    return <Navigate to="/app" replace />;
  }

  return <>{children}</>;
}
