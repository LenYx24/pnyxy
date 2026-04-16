import { Outlet, useLocation } from "react-router";
import { cn } from "@/lib/cn";
import { useUIStore } from "@/stores/ui-store";
import { useAuthStore } from "@/stores/auth-store";
import { useIsDesktop } from "@/hooks/use-media-query";
import { useKeyboardShortcut } from "@/hooks/use-keyboard-shortcut";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";
import { BottomNav } from "./BottomNav";
import { BannedScreen } from "@/features/admin/BannedScreen";
import { StreakCelebrationModal } from "@/features/library/StreakCelebrationModal";

export function AppLayout() {
  const { sidebarCollapsed, toggleSidebar } = useUIStore();
  const { isBanned, banInfo } = useAuthStore();
  const isDesktop = useIsDesktop();
  const location = useLocation();

  // Hide chrome (sidebar, topbar, bottom nav) when in reader
  const isReaderRoute = location.pathname.startsWith("/reader");

  useKeyboardShortcut({
    id: "app:toggle-sidebar",
    key: "b",
    ctrl: true,
    description: "Toggle sidebar",
    handler: toggleSidebar,
  });

  if (isBanned && banInfo) {
    return <BannedScreen />;
  }

  return (
    <div className="min-h-screen bg-bg-primary">
      {!isReaderRoute && <Sidebar />}
      {!isReaderRoute && <TopBar />}
      <main
        className={cn(
          "transition-all duration-300",
          isReaderRoute
            ? "p-0"
            : "p-4 pb-20 md:p-6 md:pb-6",
          !isReaderRoute && isDesktop && (sidebarCollapsed ? "ml-sidebar-collapsed" : "ml-sidebar-expanded"),
        )}
      >
        <Outlet />
      </main>
      {!isReaderRoute && <BottomNav />}
      <StreakCelebrationModal />
    </div>
  );
}
