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
import { ContextMenu } from "@/components/ui";
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

  // Sidebar (desktop/tablet) is shown on the reader too, so users can
  // jump back to library / browse / streaks without backing out. On
  // mobile the reader has its own permanent bottom bar
  // (MobileReaderBottomBar), so we still hide the global BottomNav
  // there to avoid stacking two bottom rails on a phone.
  const showSidebar = !focusActive;
  const showBottomNav = !isReaderRoute && !focusActive;
  const sidebarMargin = showSidebar && isDesktop;

  return (
    <div className="min-h-screen bg-bg-primary">
      {showSidebar && <Sidebar />}
      {/* main is flex-col + min-h-screen so a flex-1 content wrapper
          stretches to fill the viewport on short pages — that's what
          pins the footer (and the bottom-nav spacer) to the visual
          bottom on About / Privacy / Terms / Help. */}
      <main
        className={cn(
          "flex min-h-screen flex-col transition-[margin] duration-200 ease-out",
          sidebarMargin && (sidebarCollapsed ? "ml-sidebar-collapsed" : "ml-sidebar-expanded"),
        )}
      >
        <div
          className={cn(
            "flex-1",
            isReaderRoute ? "p-0" : "p-4 md:p-6",
          )}
        >
          <Outlet />
        </div>
        {showFooter && <Footer />}
        {/* Spacer so app routes' content + bottom-nav don't overlap
            on mobile. Footer routes already render their own block
            and we accept it sitting partly behind the nav there. */}
        {showBottomNav && !showFooter && (
          <div aria-hidden className="h-16 md:h-0" />
        )}
      </main>
      {showBottomNav && <BottomNav />}
      <StreakCelebrationModal />
      <ContextMenu />
    </div>
  );
}
