import { useEffect } from "react";
import { Outlet, useLocation } from "react-router";
import { cn } from "@/lib/cn";
import { useUIStore } from "@/stores/ui-store";
import { useAuthStore } from "@/stores/auth-store";
import { useFocusStore } from "@/stores/focus-store";
import { useIsDesktop } from "@/hooks/use-media-query";
import { useKeyboardShortcut } from "@/hooks/use-keyboard-shortcut";
import { setShortcutGate } from "@/lib/keyboard-shortcuts";
import { Sidebar } from "./Sidebar";
import { BottomNav } from "./BottomNav";
import { Footer } from "./Footer";
import { BannedScreen } from "@/features/admin/BannedScreen";
import { StreakCelebrationModal } from "@/features/library/StreakCelebrationModal";

const STATIC_PAGE_PATHS = ["/about", "/privacy", "/terms", "/help"];

export function AppLayout() {
  const { sidebarCollapsed, toggleSidebar } = useUIStore();
  const { isBanned, banInfo } = useAuthStore();
  const focusActive = useFocusStore((s) => s.active);
  const isDesktop = useIsDesktop();
  const location = useLocation();

  // Hide chrome (sidebar, topbar, bottom nav) when in reader OR when a
  // focus session is active (user explicitly asked for an
  // uninterrupted reading surface).
  const isReaderRoute = location.pathname.startsWith("/reader");

  // Footer is only rendered on the informational / legal pages. The
  // main app surfaces (library, browse, reader, settings, profile,
  // streaks, admin) use the sidebar for navigation and don't need a
  // site-wide footer taking up viewport space.
  const showFooter = STATIC_PAGE_PATHS.some((p) =>
    location.pathname.startsWith(p),
  );

  useKeyboardShortcut({
    id: "app:toggle-sidebar",
    key: "b",
    ctrl: true,
    description: "Toggle sidebar",
    handler: toggleSidebar,
  });

  // While a focus session is active, only reading-related shortcuts and
  // the sidebar toggle pass through; navigation/library/forum hotkeys
  // are silently ignored to discourage accidental tab-switching.
  useEffect(() => {
    if (focusActive) {
      setShortcutGate(
        (id) => id.startsWith("reader:") || id === "app:toggle-sidebar",
      );
      return () => setShortcutGate(null);
    }
    return undefined;
  }, [focusActive]);

  if (isBanned && banInfo) {
    return <BannedScreen />;
  }

  return (
    <div className="min-h-screen bg-bg-primary">
      {!isReaderRoute && <Sidebar />}
      <main
        className={cn(
          "transition-[margin] duration-200 ease-out",
          isReaderRoute
            ? "p-0"
            : "p-4 pb-20 md:p-6 md:pb-6",
          !isReaderRoute && isDesktop && (sidebarCollapsed ? "ml-sidebar-collapsed" : "ml-sidebar-expanded"),
        )}
      >
        <Outlet />
        {showFooter && <Footer />}
      </main>
      {!isReaderRoute && !focusActive && <BottomNav />}
      <StreakCelebrationModal />
    </div>
  );
}
